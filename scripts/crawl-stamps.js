const fs = require("fs");
const { JSDOM } = require("jsdom");
const xpath = require("xpath");

// ============================================================
// 기본 설정
// ============================================================

const LIST_URL =
"https://stamp.epost.go.kr/sp2/sg/spsg0101.jsp";

const BASE_URL =
"https://stamp.epost.go.kr";

const DATA_FILE =
"stamp-data.json";

// ============================================================
// 크롤링 설정
// ============================================================

// 0 = 전체 페이지
const MAX_PAGES =
Number(process.env.MAX_PAGES || 0);

// 상세 페이지 동시 처리
const CONCURRENCY =
Number(process.env.CONCURRENCY || 3);

// 요청 사이 대기
const REQUEST_DELAY =
Number(process.env.REQUEST_DELAY || 500);

// 재시도 횟수
const MAX_RETRIES =
Number(process.env.MAX_RETRIES || 3);

// ============================================================
// sleep
// ============================================================

function sleep(ms) {

return new Promise(
    resolve => setTimeout(resolve, ms)
);

}

// ============================================================
// HTML 요청
// ============================================================

async function fetchHtml(
url,
retryCount = 0
) {

try {

    console.log(`접속: ${url}`);

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
        retryCount < MAX_RETRIES
    ) {

        const waitTime =
            2000 * (retryCount + 1);

        console.log(
            `${waitTime / 1000}초 후 재시도...`
        );

        await sleep(waitTime);

        return fetchHtml(
            url,
            retryCount + 1
        );

    }


    throw error;

}

}

// ============================================================
// URL 변환
// ============================================================

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

// ============================================================
// 텍스트 정리
// ============================================================

function cleanText(text) {

return (text || "")
    .replace(/\s+/g, " ")
    .trim();

}

// ============================================================
// 날짜 정리
// ============================================================

function normalizeDate(value) {

const text =
    cleanText(value);


const match =
    text.match(
        /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/
    );


if (!match) {

    return text;

}


return (
    `${match[1]}-` +
    `${match[2].padStart(2, "0")}-` +
    `${match[3].padStart(2, "0")}`
);

}

// ============================================================
// XPath
// ============================================================

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

// ============================================================
// XPath namespace
// ============================================================

function namespaceXPath(path) {

return path
    .split("/")
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


        return `x:${match[1]}${match[2]}`;

    })
    .join("/");

}

// ============================================================
// XPath 텍스트
// ============================================================

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

// ============================================================
// XPath 속성
// ============================================================

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
    result[0].getAttribute(attribute)
    || ""
);

}

// ============================================================
// 목록 페이지에서 상세 URL 추출
// ============================================================

function extractDetailUrls(html) {

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


links.forEach(link => {

    const href =
        link.getAttribute("href");


    if (!href) {
        return;
    }


    const url =
        toAbsoluteUrl(href);


    if (url) {
        urls.add(url);
    }

});


return Array.from(urls);

}

// ============================================================
// 페이지 URL
// ============================================================

function getPageUrl(page) {

const url =
    new URL(LIST_URL);


url.searchParams.set(
    "page_num",
    String(page)
);


return url.href;

}

// ============================================================
// 상세 페이지 파싱
// ============================================================

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


stamp.design =
    stamp.title;


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

// ============================================================
// 기존 stamp-data.json
// ============================================================

function loadExistingData() {

if (
    !fs.existsSync(DATA_FILE)
) {

    return [];

}


try {

    const data =
        JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            )
        );


    if (
        !Array.isArray(data)
    ) {

        return [];

    }


    return data;

}
catch {

    console.warn(
        "기존 stamp-data.json을 읽지 못했습니다."
    );

    return [];

}

}

// ============================================================
// ID 기준 중복 제거
// ============================================================

function deduplicateById(
stamps,
existingStamps
) {

const existingMap =
    new Map();


// 기존 데이터의 키워드 보존
existingStamps.forEach(
    stamp => {

        if (
            stamp &&
            stamp.id
        ) {

            existingMap.set(
                String(stamp.id),
                stamp
            );

        }

    }
);


const resultMap =
    new Map();


stamps.forEach(stamp => {

    if (
        !stamp ||
        !stamp.id
    ) {

        return;

    }


    const id =
        String(stamp.id);


    // 이미 같은 ID가 있으면 무시
    if (
        resultMap.has(id)
    ) {

        return;

    }


    // 기존 데이터에 키워드가 있으면 유지
    const existing =
        existingMap.get(id);


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


    resultMap.set(
        id,
        stamp
    );

});


return Array.from(
    resultMap.values()
);

}

// ============================================================
// 상세 페이지 하나
// ============================================================

async function crawlStamp(
url,
index,
total
) {

try {

    console.log(
        `[${index}/${total}] ${url}`
    );


    await sleep(
        REQUEST_DELAY
    );


    const html =
        await fetchHtml(url);


    const stamp =
        parseStampDetail(
            html,
            url
        );


    if (
        !stamp.id ||
        !stamp.title
    ) {

        console.warn(
            `[${index}/${total}] ID 또는 제목 없음`
        );

    }


    console.log(
        `[${index}/${total}] ${stamp.id} / ${stamp.title}`
    );


    return stamp;

}
catch (error) {

    console.error(
        `[${index}/${total}] 실패: ${error.message}`
    );


    return null;

}

}

// ============================================================
// 동시 처리
// ============================================================

async function processInBatches(
urls
) {

const results = [];

let completed = 0;


while (
    completed < urls.length
) {

    const batch =
        urls.slice(
            completed,
            completed + CONCURRENCY
        );


    const batchResults =
        await Promise.all(

            batch.map(
                (url, index) =>
                    crawlStamp(
                        url,
                        completed +
                        index +
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


    console.log(
        `진행률: ${completed}/${urls.length}`
    );

}


return results;

}

// ============================================================
// JSON 저장
// ============================================================

function saveData(data) {

fs.writeFileSync(

    DATA_FILE,

    JSON.stringify(
        data,
        null,
        2
    ),

    "utf8"

);


console.log(
    `JSON 저장 완료: ${DATA_FILE}`
);

}

// ============================================================
// 전체 페이지 탐색
// ============================================================

async function collectAllDetailUrls() {

const allUrls =
    new Set();


let page = 1;

let previousUrls = [];


while (true) {

    if (
        MAX_PAGES > 0 &&
        page > MAX_PAGES
    ) {

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
        `===== ${page}페이지 확인 =====`
    );

    console.log(
        "========================================"
    );


    const pageUrl =
        getPageUrl(page);


    const html =
        await fetchHtml(
            pageUrl
        );


    const urls =
        extractDetailUrls(
            html
        );


    console.log(
        `${page}페이지 우표: ${urls.length}개`
    );


    // 마지막 페이지 다음에서 종료
    if (
        urls.length === 0
    ) {

        console.log(
            "더 이상 우표가 없어 종료합니다."
        );

        break;

    }


    // 존재하지 않는 페이지가
    // 이전 페이지를 반환하는 경우 방지
    const current =
        [...urls].sort();

    const previous =
        [...previousUrls].sort();


    const same =
        current.length ===
            previous.length &&
        current.every(
            (url, index) =>
                url === previous[index]
        );


    if (
        page > 1 &&
        same
    ) {

        console.log(
            "이전 페이지와 동일하여 종료합니다."
        );

        break;

    }


    urls.forEach(
        url =>
            allUrls.add(url)
    );


    console.log(
        `누적 우표 URL: ${allUrls.size}개`
    );


    previousUrls =
        urls;


    page++;


    await sleep(500);

}


return Array.from(
    allUrls
);

}

// ============================================================
// 메인
// ============================================================

async function main() {

console.log(
    "========================================"
);

console.log(
    "K-stamp 전체 우표 크롤링"
);

console.log(
    "========================================"
);


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


// --------------------------------------------------------
// 기존 데이터
// --------------------------------------------------------

const existingStamps =
    loadExistingData();


console.log(
    `기존 stamp-data.json: ${existingStamps.length}개`
);


// --------------------------------------------------------
// 전체 목록
// --------------------------------------------------------

const detailUrls =
    await collectAllDetailUrls();


console.log("");
console.log(
    `전체 상세 URL: ${detailUrls.length}개`
);


if (
    detailUrls.length === 0
) {

    throw new Error(
        "상세 URL을 찾지 못했습니다."
    );

}


// --------------------------------------------------------
// 상세 페이지
// --------------------------------------------------------

const crawled =
    await processInBatches(
        detailUrls
    );


const valid =
    crawled.filter(
        Boolean
    );


console.log("");
console.log(
    `상세 페이지 성공: ${valid.length}개`
);


// --------------------------------------------------------
// ID 기준 중복 제거
// --------------------------------------------------------

const unique =
    deduplicateById(
        valid,
        existingStamps
    );


console.log(
    `ID 중복 제거 후: ${unique.length}개`
);


// --------------------------------------------------------
// 발행일 정렬
// --------------------------------------------------------

unique.sort(
    (a, b) =>
        (
            b.issueDate || ""
        ).localeCompare(
            a.issueDate || ""
        )
);


// --------------------------------------------------------
// 저장
// --------------------------------------------------------

saveData(
    unique
);


console.log("");
console.log(
    "========================================"
);

console.log(
    "✓ K-stamp 전체 크롤링 완료"
);

console.log(
    `✓ 최종 우표 수: ${unique.length}개`
);

console.log(
    "✓ 중복 기준: ID"
);

console.log(
    "========================================"
);

}

main()
.catch(error => {

    console.error("");
    console.error(
        "❌ 크롤링 실패"
    );

    console.error(
        error
    );

    process.exit(1);

});