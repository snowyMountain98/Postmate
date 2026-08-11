const fs = require("fs");
const cheerio = require("cheerio");

const BASE_URL = "https://stamp.epost.go.kr";

const LIST_URL = `${BASE_URL}/sp2/sg/spsg0101.jsp`;

const OUTPUT_FILE = "stamp-data.json";

async function fetchHtml(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.text();
}

function absoluteUrl(url) {
    if (!url) {
        return "";
    }

    return new URL(url, BASE_URL).href;
}

function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
}

/*
 * 상세 페이지에서
 * 항목명 → 값
 * 형태로 추출
 */
function parseDetail(html, url) {
    const $ = cheerio.load(html);

    const data = {
        id: "",
        title: "",
        design: "",
        issueDate: "",
        faceValue: "",
        size: "",
        description: "",
        keywords: [],
        image: "",
        sourceUrl: url
    };

    /* 제목 */
    data.title = cleanText($("h3").first().text());

    /* 상세 정보 */
    $("table tr").each((_, row) => {
        const cells = $(row).find("th, td").map((_, cell) => cleanText($(cell).text())).get();

        if (cells.length < 2) {
            return;
        }

        const key = cells[0];
        const value = cells[1];

        if (key.includes("우표번호")) {
            data.id = value;
        }

        if (key.includes("디자인")) {
            data.design = value;
        }

        if (key.includes("발행일")) {
            data.issueDate = normalizeDate(value);
        }

        if (key.includes("액면가격")) {
            data.faceValue = value;
        }

        if (key.includes("우표크기")) {
            data.size = value;
        }
    });


    /* 상세 설명 */
    const description = $("h4").filter((_, element) => $(element).text().includes("상세설명")).next().text();
    data.description = cleanText(description);

    /* 대표 이미지 */
    const image = $("img").filter((_, element) => {
        const alt = $(element).attr("alt") || "";
        return alt.includes("우표사진");
    }).first().attr("src");

    data.image = absoluteUrl(image);

    /* 키워드 생성 */
    data.keywords = makeKeywords(data);

    return data;
}


function normalizeDate(value) {
    const match = value.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);

    if (!match) {
        return value;
    }

    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function makeKeywords(data) {
    const keywords = new Set();

    /* 디자인 자체를 키워드로 사용 */
    if (data.design) {
        keywords.add(data.design);
    }

    /* 자주 검색할 주제 */
    const dictionary = [
        "과일", "사과", "배", "감귤", "귤", "포도", "복숭아",
        "꽃", "무궁화", "벚꽃", "매화", 
        "동물", "호랑이", "사자", "곰", "새",
        "자연", "산", "바다","강","섬",
        "한국","서울","제주",
        "역사","인물","문화","문화재",
        "자동차","기차","교통",
        "스포츠","축구","야구",
        "음식","김치","전통",
        "과학","우주"
    ];

    const text = (data.title + " " + data.design + " " + data.description).toLowerCase();

    dictionary.forEach(keyword => {
        if (text.includes(keyword.toLowerCase())) {
            keywords.add(keyword);
        }
    });

    return Array.from(keywords);
}