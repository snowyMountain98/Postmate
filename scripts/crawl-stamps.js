const fs = require("fs");
const { JSDOM } = require("jsdom");
const xpath = require("xpath");
const OpenAI = require("openai");


// ==================================================
// 기본 설정
// ==================================================

const LIST_URL =
    "https://stamp.epost.go.kr/sp2/sg/spsg0101.jsp";

const OUTPUT_FILE =
    "stamp-data.json";

const BASE_URL =
    "https://stamp.epost.go.kr";


// AI 키워드 생성에 사용할 모델
// 우표 검색 키워드 생성 정도의 작업이므로
// 비용과 속도를 고려하여 mini 모델 사용
const OPENAI_MODEL =
    "gpt-5-mini";


// ==================================================
// HTML 가져오기
// ==================================================

async function fetchHtml(url) {

    console.log("");
    console.log(`접속: ${url}`);

    const response = await fetch(url, {

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

    });


    console.log(
        `응답 상태: ${response.status}`
    );


    if (!response.ok) {

        throw new Error(
            `HTTP ${response.status}: ${url}`
        );

    }


    return await response.text();

}


// ==================================================
// URL을 절대 URL로 변경
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

    } catch {

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
//
// 2026. 7. 29.
//       ↓
// 2026-07-29
// ==================================================

function normalizeDate(value) {

    const match =
        value.match(
            /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/
        );


    if (!match) {

        return cleanText(value);

    }


    const year =
        match[1];

    const month =
        match[2].padStart(2, "0");

    const day =
        match[3].padStart(2, "0");


    return `${year}-${month}-${day}`;

}


// ==================================================
// XPath로 텍스트 가져오기
// ==================================================

function getXPathText(
    document,
    path
) {

    const node =
        xpath.select(
            path,
            document
        );


    if (!node) {

        return "";

    }


    if (Array.isArray(node)) {

        if (node.length === 0) {

            return "";

        }


        return cleanText(
            node[0].textContent
        );

    }


    return cleanText(
        node.textContent
    );

}


// ==================================================
// XPath로 속성 가져오기
// ==================================================

function getXPathAttribute(
    document,
    path,
    attribute
) {

    const node =
        xpath.select(
            path,
            document
        );


    if (!node) {

        return "";

    }


    if (Array.isArray(node)) {

        if (node.length === 0) {

            return "";

        }


        return node[0]
            .getAttribute(attribute) || "";

    }


    return node
        .getAttribute(attribute) || "";

}


// ==================================================
// 목록 페이지에서 첫 번째 상세 URL 찾기
// ==================================================

function findFirstStampUrl(html) {

    const dom =
        new JSDOM(html);


    const document =
        dom.window.document;


    const links =
        document.querySelectorAll(
            "a[href*='spsg0102.jsp']"
        );


    if (links.length === 0) {

        throw new Error(
            "목록 페이지에서 상세 페이지 링크를 찾지 못했습니다."
        );

    }


    const href =
        links[0].getAttribute(
            "href"
        );


    const title =
        cleanText(
            links[0].textContent
        );


    const detailUrl =
        toAbsoluteUrl(
            href
        );


    console.log("");
    console.log(
        "===== 첫 번째 우표 ====="
    );

    console.log(
        `목록 제목: ${title}`
    );

    console.log(
        `상세 URL: ${detailUrl}`
    );


    return {

        title,

        detailUrl

    };

}


// ==================================================
// K-stamp 상세 페이지 파싱
//
// 사용자가 제공한 XPath 그대로 사용
// ==================================================

function parseStampDetail(
    html,
    sourceUrl
) {

    const dom =
        new JSDOM(html);


    const document =
        dom.window.document;


    // ----------------------------------------------
    // 사용자가 제공한 XPath
    // ----------------------------------------------

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


    // ----------------------------------------------
    // 데이터 추출
    // ----------------------------------------------

    const id =
        getXPathText(
            document,
            XPATH.id
        );


    const title =
        getXPathText(
            document,
            XPATH.title
        );


    const issueDate =
        normalizeDate(
            getXPathText(
                document,
                XPATH.issueDate
            )
        );


    const faceValue =
        getXPathText(
            document,
            XPATH.faceValue
        );


    const size =
        getXPathText(
            document,
            XPATH.size
        );


    const description =
        getXPathText(
            document,
            XPATH.description
        );


    let image =
        getXPathAttribute(
            document,
            XPATH.image,
            "src"
        );


    image =
        toAbsoluteUrl(
            image
        );


    /*
     * K-stamp에서 HTTP 주소가 내려오는 경우
     * HTTPS로 변경
     */

    image =
        image.replace(
            /^http:/,
            "https:"
        );


    // ----------------------------------------------
    // 디자인
    //
    // 현재 K-stamp의 디자인 항목은
    // 제목과 동일하게 들어오는 경우가 있으므로
    // 우선 title을 사용한다.
    //
    // 이후 실제 디자인 XPath를 확인하면
    // 별도로 분리 가능
    // ----------------------------------------------

    const design =
        title;


    const stamp = {

        id,

        title,

        design,

        issueDate,

        faceValue,

        size,

        description,

        keywords: [],

        image,

        sourceUrl

    };


    return stamp;

}


// ==================================================
// OpenAI 클라이언트
// ==================================================

function createOpenAIClient() {

    const apiKey =
        process.env.OPENAI_API_KEY;


    if (!apiKey) {

        throw new Error(
            "OPENAI_API_KEY가 GitHub Actions 환경변수에 없습니다."
        );

    }


    return new OpenAI({

        apiKey

    });

}


// ==================================================
// AI 키워드 생성
// ==================================================

async function generateKeywords(
    client,
    stamp
) {

    console.log("");
    console.log(
        "===== AI 키워드 생성 시작 ====="
    );


    const input = `

다음은 대한민국 우표의 정보입니다.

[우표 제목]
${stamp.title}

[디자인]
${stamp.design}

[발행일]
${stamp.issueDate}

[액면가격]
${stamp.faceValue}

[우표크기]
${stamp.size}

[상세설명]
${stamp.description}


이 우표를 검색하는 사용자가 입력할 가능성이 높은
한국어 검색 키워드를 최대 10개 생성하세요.

조건:

1. 반드시 한국어로 작성하세요.
2. 우표의 실제 소재와 직접 관련된 키워드만 생성하세요.
3. 제목과 디자인에서 중요한 단어를 포함하세요.
4. 상세설명에서 중요한 소재를 찾아 키워드로 포함하세요.
5. 사용자가 검색할 가능성이 높은 순서대로 정렬하세요.
6. 같은 의미의 단어를 중복해서 넣지 마세요.
7. "우표", "발행", "가격", "크기", "날짜" 같은
   단순 메타데이터는 키워드에서 제외하세요.
8. 너무 추상적인 단어는 제외하세요.
9. 최대 10개까지만 생성하세요.
10. 결과는 JSON 배열 하나만 출력하세요.

예시:

[
  "로보트태권V",
  "태권도",
  "로봇",
  "캐릭터",
  "애니메이션"
]

`;


    const response =
        await client.responses.create({

            model:
                OPENAI_MODEL,

            input,

            store:
                false

        });


    const output =
        response.output_text;


    if (!output) {

        throw new Error(
            "OpenAI API에서 응답을 받지 못했습니다."
        );

    }


    console.log(
        `AI 원본 응답: ${output}`
    );


    // ----------------------------------------------
    // JSON 배열 추출
    // ----------------------------------------------

    let jsonText =
        output.trim();


    /*
     * 혹시 AI가:
     *
     * ```json
     * [...]
     * ```
     *
     * 형태로 반환해도 처리
     */

    jsonText =
        jsonText
            .replace(
                /^```json\s*/i,
                ""
            )
            .replace(
                /^```\s*/i,
                ""
            )
            .replace(
                /\s*```$/i,
                ""
            )
            .trim();


    let keywords;


    try {

        keywords =
            JSON.parse(
                jsonText
            );

    } catch {

        /*
         * JSON 앞뒤에 다른 텍스트가
         * 붙어 있는 경우 배열 부분만 추출
         */

        const start =
            jsonText.indexOf("[");

        const end =
            jsonText.lastIndexOf("]");


        if (
            start === -1 ||
            end === -1 ||
            end <= start
        ) {

            throw new Error(
                `AI 응답을 JSON 배열로 변환하지 못했습니다: ${output}`
            );

        }


        keywords =
            JSON.parse(
                jsonText.substring(
                    start,
                    end + 1
                )
            );

    }


    if (!Array.isArray(keywords)) {

        throw new Error(
            "AI 키워드 결과가 배열이 아닙니다."
        );

    }


    // ----------------------------------------------
    // 정리
    // ----------------------------------------------

    keywords =
        keywords

            .filter(
                keyword =>
                    typeof keyword === "string"
            )

            .map(
                keyword =>
                    cleanText(keyword)
            )

            .filter(Boolean);


    /*
     * 중복 제거
     */

    keywords =
        Array.from(
            new Set(
                keywords
            )
        );


    /*
     * 최대 10개
     */

    keywords =
        keywords.slice(
            0,
            10
        );


    /*
     * 제목이 키워드에서 빠졌다면
     * 가장 앞에 추가
     */

    if (
        stamp.title &&
        !keywords.includes(
            stamp.title
        )
    ) {

        keywords.unshift(
            stamp.title
        );

    }


    /*
     * 다시 최대 10개
     */

    keywords =
        keywords.slice(
            0,
            10
        );


    console.log("");
    console.log(
        "===== AI 키워드 결과 ====="
    );

    console.log(
        JSON.stringify(
            keywords,
            null,
            2
        )
    );


    return keywords;

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
            "K-stamp + OpenAI 키워드 테스트"
        );

        console.log(
            "========================================"
        );


        // ------------------------------------------
        // 1. K-stamp 목록 페이지
        // ------------------------------------------

        const listHtml =
            await fetchHtml(
                LIST_URL
            );


        console.log(
            "목록 페이지 수집 완료"
        );


        // ------------------------------------------
        // 2. 첫 번째 상세 페이지 찾기
        // ------------------------------------------

        const firstStamp =
            findFirstStampUrl(
                listHtml
            );


        // ------------------------------------------
        // 3. 상세 페이지
        // ------------------------------------------

        const detailHtml =
            await fetchHtml(
                firstStamp.detailUrl
            );


        console.log(
            "상세 페이지 수집 완료"
        );


        // ------------------------------------------
        // 4. XPath 파싱
        // ------------------------------------------

        const stamp =
            parseStampDetail(
                detailHtml,
                firstStamp.detailUrl
            );


        console.log("");
        console.log(
            "===== K-stamp 수집 결과 ====="
        );

        console.log(
            JSON.stringify(
                stamp,
                null,
                2
            )
        );


        // ------------------------------------------
        // 5. OpenAI
        // ------------------------------------------

        const openai =
            createOpenAIClient();


        stamp.keywords =
            await generateKeywords(
                openai,
                stamp
            );


        // ------------------------------------------
        // 6. 최종 결과
        // ------------------------------------------

        console.log("");
        console.log(
            "========== 최종 데이터 =========="
        );

        console.log(
            JSON.stringify(
                stamp,
                null,
                2
            )
        );


        // ------------------------------------------
        // 7. JSON 저장
        // ------------------------------------------

        saveJson([
            stamp
        ]);


        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "✓ K-stamp + OpenAI 테스트 성공"
        );

        console.log(
            "========================================"
        );


    } catch (error) {

        console.error("");
        console.error(
            "❌ 크롤링 실패"
        );

        console.error(error);

        process.exit(1);

    }

}


main();