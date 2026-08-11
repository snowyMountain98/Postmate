const fs = require("fs");
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


// --------------------------------------------------
// 크롤링 설정
// --------------------------------------------------

// 0 = 전체 페이지
// 테스트할 때 1, 2 등으로 변경 가능
const MAX_PAGES =
    Number(process.env.MAX_PAGES || 0);


// 한 페이지에서 동시에 처리할 상세 페이지 수
const CONCURRENCY =
    Number(process.env.CONCURRENCY || 3);


// 상세 페이지 요청 사이의 최소 대기시간(ms)
const REQUEST_DELAY =
    Number(process.env.REQUEST_DELAY || 300);


// 재시도 횟수
const MAX_RETRIES =
    Number(process.env.MAX_RETRIES || 3);


// AI 키워드는 이번 전체 크롤링에서는 사용하지 않음
const ENABLE_AI =
    process.env.ENABLE_AI === "true";


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


    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

}


// ==================================================
// XPath 설정
// ==================================================

const XPATH = {

    id:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[2]/td",

    title:
        "/html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[1]/th/h4",

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
        .map(
            part => {

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


                return `x:${match[1]}${match[2]}`;

            }
        )
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

function extractDetailUrls(
    html
) {

    const dom =
        new JSDOM(html);


    const document =
        dom.window.document;


    const links =
        document.querySelectorAll(
            "a[href*='spsg0102.jsp']"
        );


    const urls =
        new Set();


    links.forEach(
        link => {

            const href =
                link.getAttribute(
                    "href"
                );


            if (!href) {

                return;

            }


            const url =
                toAbsoluteUrl(
                    href
                );


            if (url) {

                urls.add(url);

            }

        }
    );


    return Array.from(
        urls
    );

}


// ==================================================
// 마지막 페이지 번호 찾기
// ==================================================

function findLastPage(
    html
) {

    const dom =
        new JSDOM(html);


    const document =
        dom.window.document;


    const links =
        document.querySelectorAll(
            "a[href*='page_num=']"
        );


    let lastPage =
        1;


    links.forEach(
        link => {

            const href =
                link.getAttribute(
                    "href"
                );


            if (!href) {

                return;

            }


            const match =
                href.match(
                    /[?&]page_num=(\d+)/
                );


            if (!match) {

                return;

            }


            const page =
                Number(
                    match[1]
                );


            if (
                page >
                lastPage
            ) {

                lastPage =
                    page;

            }

        }
    );


    return lastPage;

}


// ==================================================
// 페이지 URL 생성
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
            "page_num",
            String(page)
        );

    }


    return url.href;

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
            "",

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

        image:
            "",

        sourceUrl

    };


    // ------------------------------------------------
    // 디자인
    // ------------------------------------------------

    stamp.design =
        stamp.title;


    // ------------------------------------------------
    // 이미지
    // ------------------------------------------------

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
                completed + CONCURRENCY
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
            "K-stamp 전체 우표 크롤링"
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
            `최대 페이지: ${MAX_PAGES === 0 ? "전체" : MAX_PAGES}`
        );


        // ==================================================
        // 1. 첫 페이지
        // ==================================================

        console.log("");
        console.log(
            "===== 1페이지 확인 ====="
        );


        const firstPageHtml =
            await fetchHtml(
                LIST_URL
            );


        const detectedLastPage =
            findLastPage(
                firstPageHtml
            );


        const lastPage =
            MAX_PAGES > 0
                ? Math.min(
                    MAX_PAGES,
                    detectedLastPage
                )
                : detectedLastPage;


        console.log("");
        console.log(
            `K-stamp 마지막 페이지: ${detectedLastPage}`
        );

        console.log(
            `실제 수집 페이지: 1 ~ ${lastPage}`
        );


        // ==================================================
        // 2. 모든 페이지에서 상세 URL 수집
        // ==================================================

        const allUrls =
            new Set();


        for (
            let page = 1;
            page <= lastPage;
            page++
        ) {

            console.log("");
            console.log(
                `===== 목록 페이지 ${page}/${lastPage} =====`
            );


            let pageHtml;


            if (
                page === 1
            ) {

                pageHtml =
                    firstPageHtml;

            }
            else {

                pageHtml =
                    await fetchHtml(
                        getPageUrl(
                            page
                        )
                    );

            }


            const urls =
                extractDetailUrls(
                    pageHtml
                );


            console.log(
                `상세 페이지 ${urls.length}개 발견`
            );


            urls.forEach(
                url =>
                    allUrls.add(
                        url
                    )
            );


            console.log(
                `누적 상세 URL: ${allUrls.size}개`
            );


            /*
             * 목록 페이지 사이에도 잠깐 대기
             */

            if (
                page <
                lastPage
            ) {

                await sleep(
                    500
                );

            }

        }


        const detailUrls =
            Array.from(
                allUrls
            );


        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            `전체 상세 페이지: ${detailUrls.length}개`
        );

        console.log(
            "========================================"
        );


        if (
            detailUrls.length === 0
        ) {

            throw new Error(
                "상세 페이지 URL을 하나도 찾지 못했습니다."
            );

        }


        // ==================================================
        // 3. 전체 상세 페이지 크롤링
        // ==================================================

        console.log("");
        console.log(
            "===== 상세 페이지 크롤링 시작 ====="
        );


        const stamps =
            await processInBatches(
                detailUrls
            );


        // ==================================================
        // 4. 실패 제거
        // ==================================================

        const validStamps =
            stamps.filter(
                Boolean
            );


        console.log("");
        console.log(
            "===== 크롤링 결과 ====="
        );


        console.log(
            `요청: ${detailUrls.length}`
        );

        console.log(
            `성공: ${validStamps.length}`
        );

        console.log(
            `실패: ${detailUrls.length - validStamps.length}`
        );


        // ==================================================
        // 5. ID 기준 중복 제거
        // ==================================================

        const stampMap =
            new Map();


        validStamps.forEach(
            stamp => {

                if (
                    stamp.id
                ) {

                    stampMap.set(
                        stamp.id,
                        stamp
                    );

                }

            }
        );


        const uniqueStamps =
            Array.from(
                stampMap.values()
            );


        console.log("");
        console.log(
            `중복 제거 후: ${uniqueStamps.length}개`
        );


        // ==================================================
        // 6. 발행일 기준 정렬
        // ==================================================

        uniqueStamps.sort(
            (a, b) => {

                return (
                    b.issueDate || ""
                ).localeCompare(
                    a.issueDate || ""
                );

            }
        );


        // ==================================================
        // 7. AI 키워드
        // ==================================================

        /*
         * 현재는 ENABLE_AI=false가 기본값.
         *
         * OpenAI API 크레딧을 충전한 뒤
         * 별도 단계에서 처리하는 것을 권장.
         */

        if (
            ENABLE_AI
        ) {

            console.log("");
            console.log(
                "⚠️ AI 키워드 생성은 현재 전체 크롤링에서 사용하지 않는 것을 권장합니다."
            );

        }


        // ==================================================
        // 8. JSON 저장
        // ==================================================

        saveJson(
            uniqueStamps
        );


        // ==================================================
        // 9. 완료
        // ==================================================

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "✓ K-stamp 전체 크롤링 완료"
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