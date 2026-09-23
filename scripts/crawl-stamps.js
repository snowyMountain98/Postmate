const fs = require("fs");
const dns = require("node:dns");

dns.setDefaultResultOrder("ipv4first");
const { JSDOM } = require("jsdom");
const xpath = require("xpath");

// ==================================================
// 기본 설정
// ==================================================

const LIST_URL =
    "https://stamp.epost.go.kr/sp2/sg/spsg0101.jsp";

const OUTPUT_FILE =
    "stamp-data.json";

const BASE_URL =
    "https://stamp.epost.go.kr";


// ==================================================
// 크롤링 설정
// ==================================================

// 0 = 전체 페이지
// 테스트할 때 1, 2 등으로 변경
const MAX_PAGES =
    Number(process.env.MAX_PAGES || 0);

// 상세 페이지 동시 처리 개수
const CONCURRENCY =
    Number(process.env.CONCURRENCY || 3);

// 요청 사이 대기시간
const REQUEST_DELAY =
    Number(process.env.REQUEST_DELAY || 500);

// 재시도 횟수
const MAX_RETRIES =
    Number(process.env.MAX_RETRIES || 3);


// ==================================================
// sleep
// ==================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    );

}


// ==================================================
// HTML 가져오기
// ==================================================

async function fetchHtml(
    url,
    retryCount = 0
) {

    try {

        console.log(
            `접속: ${url}`
        );

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36",

                        "Accept":
                            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",

                        "Accept-Language":
                            "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
                    },

                    signal:
                        AbortSignal.timeout(30000)
                }
            );


        console.log(
            `응답 상태: ${response.status}`
        );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        return await response.text();

    }
    catch (error) {

        console.error(
            `접속 실패: ${url}`
        );

        console.error(
            error.message
        );


        if (
            retryCount <
            MAX_RETRIES
        ) {

            const waitTime =
                2000 *
                (retryCount + 1);


            console.log(
                `${waitTime / 1000}초 후 재시도...`
            );


            await sleep(
                waitTime
            );


            return fetchHtml(
                url,
                retryCount + 1
            );

        }


        throw error;

    }

}


// ==================================================
// URL 변환
// ==================================================

function toAbsoluteUrl(url) {

    if (!url) {

        return "";

    }


    try {

        return new URL(
            url,
            BASE_URL
        ).href;

    }
    catch {

        return "";

    }

}


// ==================================================
// 텍스트 정리
// ==================================================

function cleanText(text) {

    return (text || "")
        .replace(/\s+/g, " ")
        .trim();

}


// ==================================================
// 날짜 변환
// ==================================================

function normalizeDate(value) {

    const match =
        value.match(
            /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/
        );


    if (!match) {

        return cleanText(
            value
        );

    }


    return (
        `${match[1]}-` +
        `${match[2].padStart(2, "0")}-` +
        `${match[3].padStart(2, "0")}`
    );

}


// ==================================================
// XPath 설정
// ==================================================

const XPATH = {

    id:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[2]/td",

    title:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[1]/th/h4",

    design:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[5]/td",

    issueDate:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[9]/td",

    faceValue:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[10]/td",

    size:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[11]/td",

    description:
        "/html/body/div/div[3]/div[2]/div[3]/div[2]/p[2]",

    image:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/div/p/img"

};


// ==================================================
// XPath namespace
// ==================================================

function namespaceXPath(path) {

    const parts =
        path.split("/");


    return parts
        .map(part => {

            if (!part) {

                return "";

            }


            const match =
                part.match(
                    /^([a-zA-Z0-9_-]+)(.*)$/
                );


            if (!match) {

                return part;

            }


            return (
                `x:${match[1]}${match[2]}`
            );

        })
        .join("/");

}


// ==================================================
// XPath 텍스트
// ==================================================

function getXPathText(
    document,
    path,
    select
) {

    const result =
        select(
            namespaceXPath(path),
            document
        );


    if (
        !result ||
        result.length === 0
    ) {

        return "";

    }


    return cleanText(
        result[0].textContent
    );

}


// ==================================================
// XPath 속성
// ==================================================

function getXPathAttribute(
    document,
    path,
    attribute,
    select
) {

    const result =
        select(
            namespaceXPath(path),
            document
        );


    if (
        !result ||
        result.length === 0
    ) {

        return "";

    }


    return (
        result[0]
            .getAttribute(attribute)
        || ""
    );

}


// ==================================================
// 목록 페이지에서 상세 URL 추출
// ==================================================

function extractDetailCandidates(
    html
) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const links = document.querySelectorAll("a[href*='spsg0102.jsp']");
    const candidates = [];

    links.forEach(link => {
        const href = link.getAttribute("href");
        if (!href) return;

        const url = toAbsoluteUrl(href);
        if (!url) return;

        // 우체국 목록 페이지의 상세 링크는 href 구조가 변경될 수 있으므로
        // 링크가 속한 행에서 ID를 추측하지 않고 href 자체의 파라미터를 우선 확인합니다.
        let stampId = "";

        try {
            const parsedUrl = new URL(url);
            const params = parsedUrl.searchParams;

            const idParamNames = [
                "seq",
                "stampId",
                "stampID",
                "issueNo",
                "issueNum",
                "no",
                "id"
            ];

            for (const name of idParamNames) {
                const value = params.get(name);
                if (value && /^\d{4,}$/.test(value.trim())) {
                    stampId = value.trim();
                    break;
                }
            }
        } catch {
            // 아래 DOM 기반 탐색으로 fallback
        }

        // href에 ID가 없는 경우 링크/행 내부에서 숫자 값을 찾습니다.
        if (!stampId) {
            const row = link.closest("tr");

            if (row) {
                const cells = Array.from(row.querySelectorAll("td"))
                    .map(cell => cleanText(cell.textContent));

                // 기존 구조뿐 아니라 숫자만 있는 셀을 모두 후보로 사용합니다.
                const numericValues = cells.filter(value =>
                    /^\d{4,}$/.test(value)
                );

                if (numericValues.length > 0) {
                    // 일반적으로 우표번호는 목록의 앞쪽 숫자 컬럼입니다.
                    stampId = numericValues[0];
                }
            }
        }

        // ID를 찾지 못해도 URL 자체는 수집합니다.
        // 상세 페이지에서 실제 ID를 파싱할 수 있으므로 URL을 버리지 않습니다.
        candidates.push({
            id: stampId ? String(stampId).trim() : "",
            url
        });
    });

    const unique = new Map();

    candidates.forEach(candidate => {
        // ID가 있으면 ID 기준으로 중복 제거합니다.
        if (candidate.id) {
            if (!unique.has(candidate.id)) {
                unique.set(candidate.id, candidate);
            }
            return;
        }

        // ID를 목록에서 찾지 못한 링크는 URL 기준으로 중복 제거합니다.
        const key = candidate.url;

        if (!unique.has(key)) {
            unique.set(key, candidate);
        }
    });

    return Array.from(unique.values());
}


// ==================================================
// 페이지 URL
// ==================================================

function getPageUrl(
    page
) {

    const url =
        new URL(
            LIST_URL
        );


    if (page > 1) {

        url.searchParams.set(
            "currentPage",
            String(page)
        );

    }


    return url.href;

}


// ==================================================
// 전체 페이지에서 상세 URL 수집
// ==================================================

async function collectAllDetailUrls(
    firstPageHtml
) {

    const allCandidates =
        new Map();


    let page = 1;

    let previousPageCandidates = null;


    while (true) {

        if (
            MAX_PAGES > 0 &&
            page > MAX_PAGES
        ) {

            console.log("");
            console.log(
                `MAX_PAGES=${MAX_PAGES} 도달`
            );

            break;

        }


        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            `===== 목록 페이지 ${page} =====`
        );

        console.log(
            "========================================"
        );


        let pageHtml;


        if (page === 1) {

            pageHtml =
                firstPageHtml;

        }
        else {

            const pageUrl =
                getPageUrl(
                    page
                );


            console.log(
                `페이지 URL: ${pageUrl}`
            );


            pageHtml =
                await fetchHtml(
                    pageUrl
                );

        }


        const pageCandidates =
            extractDetailCandidates(
                pageHtml
            );


        console.log(
            `${page}페이지 상세 URL: ${pageCandidates.length}개`
        );


        if (
            pageCandidates.length === 0
        ) {

            console.log(
                "상세 URL이 없어 페이지 탐색을 종료합니다."
            );

            break;

        }


        const currentSorted = pageCandidates.map(candidate => candidate.id).sort();


        const previousSorted = previousPageCandidates ? previousPageCandidates.map(candidate => candidate.id).sort() : null;


        const sameAsPrevious =
            previousSorted &&
            currentSorted.length ===
                previousSorted.length &&
            currentSorted.every(
                (url, index) =>
                    url ===
                    previousSorted[index]
            );


        if (
            sameAsPrevious
        ) {

            console.log(
                "이전 페이지와 동일한 내용입니다."
            );

            console.log(
                "페이지 탐색을 종료합니다."
            );

            break;

        }


        let newUrlCount = 0;


        pageCandidates.forEach(candidate => {

                if (
                    !allCandidates.has(candidate.id)
                ) {

                    allCandidates.set(candidate.id, candidate);

                    newUrlCount++;

                }

            }
        );


        console.log(
            `새로운 우표: ${newUrlCount}개`
        );

        console.log(
            `누적 상세 URL: ${allCandidates.size}개`
        );


        if (
            page > 1 &&
            newUrlCount === 0
        ) {

            console.log(
                "새로운 우표가 없어 종료합니다."
            );

            break;

        }


        previousPageCandidates =
            pageCandidates;


        page++;


        await sleep(
            700
        );

    }


    return Array.from(allCandidates.values());

}


// ==================================================
// 상세 페이지 파싱
// ==================================================

function parseStampDetail(
    html,
    sourceUrl
) {

    const dom =
        new JSDOM(html);


    const document =
        dom.window.document;


    const select =
        xpath.useNamespaces({
            x:
                "http://www.w3.org/1999/xhtml"
        });


const stamp = {

    id:
        getXPathText(
            document,
            XPATH.id,
            select
        ),

    title:
        getXPathText(
            document,
            XPATH.title,
            select
        ),

    design:
        getXPathText(
            document,
            XPATH.design,
            select
        ),

    issueDate:
        normalizeDate(
            getXPathText(
                document,
                XPATH.issueDate,
                select
            )
        ),

    faceValue:
        getXPathText(
            document,
            XPATH.faceValue,
            select
        ),

    size:
        getXPathText(
            document,
            XPATH.size,
            select
        ),

    description:
        getXPathText(
            document,
            XPATH.description,
            select
        ),

    keywords: [],

    image: "",

    sourceUrl

};


    stamp.image =
        getXPathAttribute(
            document,
            XPATH.image,
            "src",
            select
        );


    stamp.image =
        toAbsoluteUrl(
            stamp.image
        );


    stamp.image =
        stamp.image.replace(
            /^http:/,
            "https:"
        );


    return stamp;

}


// ==================================================
// 데이터 검증
// ==================================================

function isValidStamp(
    stamp
) {

    return Boolean(
        stamp.id &&
        stamp.title &&
        stamp.issueDate &&
        stamp.faceValue &&
        stamp.size &&
        stamp.description &&
        stamp.image
    );

}


// ==================================================
// 상세 페이지 하나 처리
// ==================================================

async function crawlStamp(
    url,
    index,
    total
) {

    try {

        console.log("");
        console.log(
            `[${index}/${total}] 우표 수집 시작`
        );


        await sleep(
            REQUEST_DELAY
        );


        const html =
            await fetchHtml(
                url
            );


        const stamp =
            parseStampDetail(
                html,
                url
            );


        if (
            !isValidStamp(
                stamp
            )
        ) {

            console.warn(
                `[${index}/${total}] 데이터 일부 누락`
            );

            console.warn(
                JSON.stringify(
                    stamp,
                    null,
                    2
                )
            );

        }


        console.log(
            `[${index}/${total}] ${stamp.id} / ${stamp.title}`
        );


        return stamp;

    }
    catch (error) {

        console.error(
            `[${index}/${total}] 실패`
        );

        console.error(
            error.message
        );


        return null;

    }

}


// ==================================================
// 동시 처리
// ==================================================

async function processInBatches(
    urls
) {

    const results =
        [];


    let completed =
        0;


    while (
        completed <
        urls.length
    ) {

        const batch =
            urls.slice(
                completed,
                completed +
                    CONCURRENCY
            );


        const batchResults =
            await Promise.all(
                batch.map(
                    (url, batchIndex) =>
                        crawlStamp(
                            url,
                            completed +
                                batchIndex +
                                1,
                            urls.length
                        )
                )
            );


        results.push(
            ...batchResults
        );


        completed +=
            batch.length;


        console.log("");
        console.log(
            `진행률: ${completed}/${urls.length} (${((completed / urls.length) * 100).toFixed(1)}%)`
        );

    }


    return results;

}


// ==================================================
// 기존 데이터 불러오기
// ==================================================

function loadExistingData() {

    if (
        !fs.existsSync(
            OUTPUT_FILE
        )
    ) {

        return [];

    }


    try {

        const data =
            JSON.parse(
                fs.readFileSync(
                    OUTPUT_FILE,
                    "utf8"
                )
            );


        return Array.isArray(data)
            ? data
            : [];

    }
    catch (error) {

        console.warn(
            "기존 stamp-data.json을 읽지 못했습니다."
        );

        console.warn(
            error.message
        );


        return [];

    }

}


// ==================================================
// 기존 데이터의 AI 키워드 보존
// ==================================================

function mergeExistingKeywords(
    stamps,
    existingStamps
) {

    const existingMap =
        new Map();


    existingStamps.forEach(
        stamp => {

            if (
                stamp &&
                stamp.id
            ) {

                existingMap.set(
                    String(
                        stamp.id
                    ).trim(),
                    stamp
                );

            }

        }
    );


    stamps.forEach(
        stamp => {

            const existing =
                existingMap.get(
                    String(
                        stamp.id
                    ).trim()
                );


            if (
                existing &&
                Array.isArray(
                    existing.keywords
                ) &&
                existing.keywords.length > 0
            ) {

                stamp.keywords =
                    existing.keywords;

            }

        }
    );


    return stamps;

}


// ==================================================
// ID 기준 중복 제거
// ==================================================

function removeDuplicateById(
    stamps
) {

    const stampMap =
        new Map();


    stamps.forEach(
        stamp => {

            if (
                !stamp ||
                !stamp.id
            ) {

                return;

            }


            const id =
                String(
                    stamp.id
                ).trim();


            if (
                !stampMap.has(id)
            ) {

                stampMap.set(
                    id,
                    stamp
                );

            }

        }
    );


    return Array.from(
        stampMap.values()
    );

}


// ==================================================
// JSON 저장
// ==================================================

function saveJson(
    stamps
) {

    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(
            stamps,
            null,
            2
        ),
        "utf8"
    );


    console.log("");
    console.log(
        `JSON 저장 완료: ${OUTPUT_FILE}`
    );

}


// ==================================================
// 메인
// ==================================================

async function main() {

    try {

        console.log(
            "========================================"
        );

        console.log(
            "K-stamp 신규 우표 증분 크롤링"
        );

        console.log(
            "========================================"
        );


        console.log("");
        console.log(
            `동시 처리: ${CONCURRENCY}`
        );

        console.log(
            `요청 간 대기: ${REQUEST_DELAY}ms`
        );

        console.log(
            `최대 페이지: ${
                MAX_PAGES === 0
                    ? "전체"
                    : MAX_PAGES
            }`
        );


        // ==================================================
        // 기존 데이터
        // ==================================================

        const existingStamps =
            loadExistingData();


        console.log("");
        console.log(
            `기존 데이터: ${existingStamps.length}개`
        );


        // ==================================================
        // 첫 페이지
        // ==================================================

        console.log("");
        console.log(
            "===== 1페이지 확인 ====="
        );


        const firstPageHtml =
            await fetchHtml(
                LIST_URL
            );


        // ==================================================
        // 전체 목록 페이지
        // ==================================================

        const detailCandidates =
            await collectAllDetailUrls(
                firstPageHtml
            );


        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            `전체 상세 페이지: ${detailCandidates.length}개`
        );

        console.log(
            "========================================"
        );


        if (
            detailCandidates.length === 0
        ) {

            throw new Error(
                "상세 페이지 URL을 하나도 찾지 못했습니다."
            );

        }


        // ==================================================
        // 상세 페이지 크롤링
        // ==================================================

        console.log("");
        console.log(
            "===== 상세 페이지 크롤링 시작 ====="
        );


        const existingIds =
            new Set(
                existingStamps
                    .filter(stamp => stamp && stamp.id)
                    .map(stamp => String(stamp.id).trim())
            );

        const newCandidates =
            detailCandidates.filter(
                candidate => !existingIds.has(candidate.id)
            );

        console.log("");
        console.log(`기존 우표: ${existingIds.size}개`);
        console.log(`신규 우표: ${newCandidates.length}개`);
        console.log(`상세 페이지 요청 생략: ${detailCandidates.length - newCandidates.length}개`);

        const stamps =
            await processInBatches(
                newCandidates.map(candidate => candidate.url)
            );


        const validStamps =
            stamps.filter(
                Boolean
            );


        console.log("");
        console.log(
            "===== 크롤링 결과 ====="
        );

        console.log(
            `요청: ${newCandidates.length}`
        );

        console.log(
            `성공: ${validStamps.length}`
        );

        console.log(
            `실패: ${
                newCandidates.length - validStamps.length
            }`
        );


        // ==================================================
        // 기존 키워드 병합
        // ==================================================

        mergeExistingKeywords(
            validStamps,
            existingStamps
        );


        // ==================================================
        // ID 기준 중복 제거
        // ==================================================

        const uniqueStamps =
            removeDuplicateById(
                [
                    ...existingStamps,
                    ...validStamps
                ]
            );


        console.log("");
        console.log(
            `ID 중복 제거 후: ${uniqueStamps.length}개`
        );


        // ==================================================
        // 발행일 기준 최신순 정렬
        // ==================================================

        uniqueStamps.sort(
            (a, b) =>
                (
                    b.issueDate || ""
                ).localeCompare(
                    a.issueDate || ""
                )
        );


        // ==================================================
        // 저장
        // ==================================================

        saveJson(
            uniqueStamps
        );


        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "✓ K-stamp 신규 우표 증분 크롤링 완료"
        );

        console.log(
            `✓ 총 ${uniqueStamps.length}개 우표 저장`
        );

        console.log(
            "========================================"
        );

    }
    catch (error) {

        console.error("");
        console.error(
            "❌ 크롤링 실패"
        );

        console.error(
            error
        );


        process.exit(1);

    }

}


main();