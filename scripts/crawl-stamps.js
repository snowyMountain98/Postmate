const fs = require("fs");
const cheerio = require("cheerio");

const LIST_URL = "https://stamp.epost.go.kr/sp2/sg/spsg0101.jsp";

const OUTPUT_FILE = "stamp-data.json";

const BASE_URL = "https://stamp.epost.go.kr";


// ==================================================
// HTML 가져오기
// ==================================================
async function fetchHtml(url) {
    console.log(`접속: ${url}`);

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        signal: AbortSignal.timeout(30000)
    });

    console.log(`응답 상태: ${response.status}`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.text();
}

// ==================================================
// URL 변환
// ==================================================
function toAbsoluteUrl(url) {
    if (!url) {
        return "";
    }

    try {
        return new URL(url, BASE_URL).href;
    } catch {
        return "";
    }
}

// ==================================================
// 텍스트 정리
// ==================================================
function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
}

// ==================================================
// 날짜 변환
// ==================================================
function normalizeDate(value) {
    const match = value.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);

    if (!match) {
        return cleanText(value);
    }

    return [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
}


// ==================================================
// 목록 → 첫 번째 상세 URL
// ==================================================
function findFirstStampUrl(html) {
    const $ = cheerio.load(html);

    let detailUrl = "";

    $("a[href*='spsg0102.jsp']").each((_, element) => {
        if (detailUrl) {
            return;
        }

        const href = $(element).attr("href");

        if (href) {
            detailUrl = toAbsoluteUrl(href);
        }
    });

    if (!detailUrl) {
        throw new Error("상세 페이지 URL을 찾지 못했습니다.");
    }

    console.log("");
    console.log("===== 첫 번째 우표 =====");
    console.log(`상세 URL: ${detailUrl}`);
    console.log("");

    return detailUrl;
}

// ==================================================
// XPath와 동일한 CSS 선택자 방식
// ==================================================
function extractStamp(html, url) {
    const $ = cheerio.load(html);

    /*
     * 사용자가 제공한 XPath
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[2]/td
     * → id
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[1]/th/h4
     * → title
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[9]/td
     * → issueDate
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[10]/td
     * → faceValue
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[1]/table/tbody/tr[11]/td
     * → size
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[2]/p[2]
     * → description
     *
     * /html/body/div/div[3]/div[2]/div[3]/div[1]/div/p/img
     * → image
     */

    const table = $("table").first();

    const rows = table.find("tbody > tr");

    const stamp = {
        id: cleanText(rows.eq(1).find("td").text()),
        title: cleanText(rows.eq(0).find("th h4").text()),
        design: "",
        issueDate: normalizeDate(rows.eq(8).find("td").text()),
        faceValue: cleanText(rows.eq(9).find("td").text()),
        size: cleanText(rows.eq(10).find("td").text()),
        description: cleanText($("div").eq(3).find("p").eq(1).text()),
        keywords: [],
        image: "",
        sourceUrl: url
    };

    // ----------------------------------------------
    // 디자인
    // ----------------------------------------------
    rows.each((_, row) => {
        const cells = $(row).find("th, td").map((_, cell) => cleanText($(cell).text())).get();

        if (cells.length >= 2 && cells[0].includes("디자인")) {
            stamp.design = cells[1];
        }
    });

    // ----------------------------------------------
    // 이미지
    // ----------------------------------------------
    const image = $("div").eq(3).find("div").first().find("p img").first();
    let imageUrl = image.attr("src") || "";
    imageUrl = toAbsoluteUrl(imageUrl);
    /* HTTP 이미지라면 HTTPS로 변경 */
    imageUrl = imageUrl.replace(/^http:/, "https:");
    stamp.image = imageUrl;
    return stamp;
}

// ==================================================
// AI 키워드 생성
// ==================================================
async function generateKeywords(stamp) {
    console.log("");
    console.log("AI 키워드 생성 시작...");

    const token = process.env.GITHUB_TOKEN;

    if (!token) {
        throw new Error("GITHUB_TOKEN이 없습니다.");
    }

    const prompt = `
다음은 한국 우표의 정보입니다.

우표 제목: ${stamp.title}
디자인: ${stamp.design}
발행일: ${stamp.issueDate}
액면가격: ${stamp.faceValue}
우표크기: ${stamp.size}
상세설명: ${stamp.description}

이 우표를 검색할 때 도움이 되는 한국어 키워드를 최대 10개 생성하세요.

조건:
1. 반드시 한국어 키워드만 사용하세요.
2. 우표의 실제 내용과 직접 관련된 단어만 사용하세요.
3. 제목이나 디자인에 있는 단어도 포함할 수 있습니다.
4. 상위 검색어 순서대로 중요도가 높은 것부터 작성하세요.
5. 너무 일반적인 단어(우표, 발행, 가격 등)는 제외하세요.
6. 중복되는 단어는 제외하세요.
7. 반드시 JSON 배열만 출력하세요.

예:
["로봇","태권도","애니메이션","캐릭터","만화"]
`;

    const response = await fetch("https://models.github.ai/inference/chat/completions", {
        method: "POST",
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${token}`,
            "X-GitHub-Api-Version": "2026-03-10",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "openai/gpt-4.1",
            messages: [{
                role: "system",
                content: "You generate concise Korean search keywords."
            }, {
                role: "user",
                content: prompt
            }],
            temperature: 0.2,
            max_tokens: 200
        })
    });

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(`GitHub Models API 오류 ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    const content = result?.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error("AI 응답이 없습니다.");
    }

    console.log(`AI 응답: ${content}`);

    /* ```json ... ``` 형태로 오는 경우 제거 */

    const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();

    let keywords;

    try {
        keywords = JSON.parse(cleaned);
    } catch {
        throw new Error(`AI 응답을 JSON으로 변환할 수 없습니다: ${cleaned}`);
    }

    if (!Array.isArray(keywords)) {
        throw new Error("AI 키워드 결과가 배열이 아닙니다.");
    }

    /* 최대 10개 문자열만 빈 값 제거 중복 제거 */
    keywords = keywords.filter(keyword => typeof keyword === "string").map(keyword => cleanText(keyword)).filter(Boolean);

    keywords = Array.from(new Set(keywords)).slice(0, 10);

    /* 디자인은 검색에 매우 중요하므로 AI가 빠뜨렸다면 앞쪽에 추가 */
    if (stamp.design && !keywords.includes(stamp.design)) {
        keywords.unshift(stamp.design);
    }

    /* 최종 10개 */
    return keywords.slice(0, 10);
}

// ==================================================
// JSON 저장
// ==================================================
function saveJson(data) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf8");

    console.log("");
    console.log(`JSON 저장 완료: ${OUTPUT_FILE}`);
}

// ==================================================
// 실행
// ==================================================
async function main() {
    try {
        console.log("========================================");
        console.log("K-stamp 크롤링 + AI 키워드 테스트");
        console.log("========================================");

        // 1. 목록
        const listHtml = await fetchHtml(LIST_URL);

        console.log("목록 페이지 수집 완료");

        // 2. 첫 번째 상세 URL
        const detailUrl = findFirstStampUrl(listHtml);

        // 3. 상세 페이지
        const detailHtml = await fetchHtml(detailUrl);

        console.log("상세 페이지 수집 완료");

        // 4. HTML 파싱
        const stamp = extractStamp(detailHtml, detailUrl);

        console.log("");
        console.log("===== K-stamp 데이터 =====");

        console.log(JSON.stringify(stamp, null, 2));

        // 5. AI 키워드
        stamp.keywords = await generateKeywords(stamp);

        console.log("");
        console.log("===== 최종 데이터 =====");
        console.log(JSON.stringify(stamp, null, 2));

        // 6. 저장
        saveJson([stamp]);

        console.log("");
        console.log("✓ 테스트 완료");
    } catch (error) {
        console.error("");
        console.error("❌ 크롤링 실패");
        console.error(error);
        process.exit(1);
    }
}

main();