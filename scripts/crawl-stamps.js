const fs = require("fs");
const { JSDOM } = require("jsdom");
const xpath = require("xpath");
const OpenAI = require("openai");

const LIST_URL =
    "https://stamp.epost.go.kr/sp2/sg/spsg0101.jsp";

const OUTPUT_FILE =
    "stamp-data.json";

const BASE_URL =
    "https://stamp.epost.go.kr";

const OPENAI_MODEL =
    "gpt-5-mini";


// ==================================================
// HTML 가져오기
// ==================================================

async function fetchHtml(url) {

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
// URL
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
// 날짜
// ==================================================

function normalizeDate(value) {

    const match =
        value.match(
            /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/
        );

    if (!match) {
        return cleanText(value);
    }

    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}


// ==================================================
// XPath
//
// 핵심:
// 네가 제공한 XPath 자체는 그대로 유지하고
// HTML namespace에 맞춰 prefix를 자동으로 붙인다.
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
// XPath에 HTML namespace 적용
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
                part.match(/^([a-zA-Z0-9_-]+)(.*)$/);

            if (!match) {
                return part;
            }

            return `x:${match[1]}${match[2]}`;

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

    const namespacedPath =
        namespaceXPath(path);

    const result =
        select(
            namespacedPath,
            document
        );

    if (!result || result.length === 0) {
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

    const namespacedPath =
        namespaceXPath(path);

    const result =
        select(
            namespacedPath,
            document
        );

    if (!result || result.length === 0) {
        return "";
    }

    return (
        result[0].getAttribute(attribute) || ""
    );
}


// ==================================================
// 첫 번째 상세 URL
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
            "상세 페이지 링크를 찾지 못했습니다."
        );
    }

    const href =
        links[0].getAttribute("href");

    const detailUrl =
        toAbsoluteUrl(href);

    console.log("");
    console.log(
        "===== 첫 번째 우표 ====="
    );

    console.log(
        `상세 URL: ${detailUrl}`
    );

    return detailUrl;
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

    /*
     * 중요:
     *
     * JSDOM의 HTML DOM은 XHTML namespace를 사용하므로
     * x: prefix를 사용하는 XPath 선택기를 생성한다.
     */

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


    // ----------------------------------------------
    // 이미지
    // ----------------------------------------------

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


    // ----------------------------------------------
    // 디자인
    // ----------------------------------------------

    /*
     * 현재 확인된 페이지에서는
     * 디자인 값이 제목과 동일하다.
     *
     * 실제 디자인 행을 별도 XPath로 확인하면
     * 나중에 분리 가능하다.
     */

    stamp.design =
        stamp.title;


    return stamp;
}


// ==================================================
// 결과 검증
// ==================================================

function validateStamp(stamp) {

    const requiredFields = [
        "id",
        "title",
        "issueDate",
        "faceValue",
        "size",
        "description",
        "image"
    ];

    const missing =
        requiredFields.filter(
            field =>
                !stamp[field]
        );

    if (missing.length > 0) {

        throw new Error(
            `필수 데이터 추출 실패: ${missing.join(", ")}`
        );
    }
}


// ==================================================
// OpenAI
// ==================================================

function createOpenAIClient() {

    const apiKey =
        process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error(
            "OPENAI_API_KEY가 없습니다."
        );
    }

    return new OpenAI({
        apiKey
    });
}


// ==================================================
// AI 키워드
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
다음 한국 우표의 검색 키워드를 생성하세요.

제목: ${stamp.title}
디자인: ${stamp.design}
상세설명: ${stamp.description}

조건:
- 한국어만 사용
- 실제 우표 소재와 관련된 단어
- 검색어로 사용할 만한 단어
- 최대 10개
- 중요도 순서
- 중복 금지
- "우표", "발행일", "가격", "크기" 같은 메타데이터 제외
- JSON 배열만 출력

예:
["로보트태권V","로봇","태권도","애니메이션","캐릭터"]
`;

    const response =
        await client.responses.create({

            model:
                OPENAI_MODEL,

            input,

            store:
                false
        });

    let output =
        response.output_text;

    if (!output) {
        throw new Error(
            "OpenAI 응답이 없습니다."
        );
    }

    output =
        output
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
            JSON.parse(output);

    } catch {

        const start =
            output.indexOf("[");

        const end =
            output.lastIndexOf("]");

        if (
            start === -1 ||
            end === -1
        ) {

            throw new Error(
                `AI 응답 JSON 파싱 실패: ${output}`
            );
        }

        keywords =
            JSON.parse(
                output.substring(
                    start,
                    end + 1
                )
            );
    }

    if (!Array.isArray(keywords)) {
        throw new Error(
            "AI 결과가 배열이 아닙니다."
        );
    }

    return Array.from(
        new Set(
            keywords
                .filter(
                    keyword =>
                        typeof keyword === "string"
                )
                .map(
                    keyword =>
                        cleanText(keyword)
                )
                .filter(Boolean)
        )
    ).slice(0, 10);
}


// ==================================================
// JSON 저장
// ==================================================

function saveJson(stamp) {

    fs.writeFileSync(

        OUTPUT_FILE,

        JSON.stringify(
            [stamp],
            null,
            2
        ),

        "utf8"
    );

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
            "K-stamp + OpenAI 테스트"
        );

        console.log(
            "========================================"
        );


        // 1. 목록
        const listHtml =
            await fetchHtml(
                LIST_URL
            );


        console.log(
            "목록 페이지 수집 완료"
        );


        // 2. 상세 URL
        const detailUrl =
            findFirstStampUrl(
                listHtml
            );


        // 3. 상세
        const detailHtml =
            await fetchHtml(
                detailUrl
            );


        console.log(
            "상세 페이지 수집 완료"
        );


        // 4. XPath
        const stamp =
            parseStampDetail(
                detailHtml,
                detailUrl
            );


        console.log("");
        console.log(
            "===== K-stamp 데이터 ====="
        );

        console.log(
            JSON.stringify(
                stamp,
                null,
                2
            )
        );


        // 5. 필수값 검증
        validateStamp(stamp);


        console.log(
            "✓ K-stamp 데이터 검증 성공"
        );


        // ------------------------------------------
        // 6. OpenAI
        // ------------------------------------------

        const openai =
            createOpenAIClient();


        stamp.keywords =
            await generateKeywords(
                openai,
                stamp
            );


        // 7. 저장
        saveJson(stamp);


        console.log("");
        console.log(
            "✓ 전체 테스트 성공"
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