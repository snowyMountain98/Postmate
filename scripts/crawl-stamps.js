const fs = require("fs");
const cheerio = require("cheerio");

const LIST_URL =
    "https://stamp.epost.go.kr/sp2/sg/spsg0101.jsp";

const OUTPUT_FILE = "stamp-data.json";

const BASE_URL = "https://stamp.epost.go.kr";


// --------------------------------------------------
// HTML 가져오기
// --------------------------------------------------

async function fetchHtml(url) {

    console.log(`접속: ${url}`);

    const response = await fetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (compatible; PostmateStampCrawler/1.0)"
        }
    });

    console.log(`응답 상태: ${response.status}`);

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}: ${url}`
        );
    }

    return await response.text();
}


// --------------------------------------------------
// 상대 URL → 절대 URL
// --------------------------------------------------

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


// --------------------------------------------------
// 공백 정리
// --------------------------------------------------

function cleanText(text) {

    return (text || "")
        .replace(/\s+/g, " ")
        .trim();
}


// --------------------------------------------------
// 날짜 변환
// 2026. 7. 29. → 2026-07-29
// --------------------------------------------------

function normalizeDate(value) {

    const match = value.match(
        /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/
    );

    if (!match) {
        return cleanText(value);
    }

    const year = match[1];

    const month =
        match[2].padStart(2, "0");

    const day =
        match[3].padStart(2, "0");

    return `${year}-${month}-${day}`;
}


// --------------------------------------------------
// 목록 페이지에서 첫 번째 상세 URL 찾기
// --------------------------------------------------

function findFirstStampUrl(html) {

    const $ = cheerio.load(html);

    let detailUrl = "";
    let title = "";

    /*
     * K-stamp 목록에서 spsg0102.jsp로 연결되는
     * 첫 번째 링크를 찾는다.
     */

    $("a[href*='spsg0102.jsp']").each(
        (_, element) => {

            if (detailUrl) {
                return;
            }

            const href =
                $(element).attr("href");

            const text =
                cleanText(
                    $(element).text()
                );

            if (href) {

                detailUrl =
                    toAbsoluteUrl(href);

                title = text;

            }

        }
    );


    if (!detailUrl) {

        throw new Error(
            "목록 페이지에서 상세 페이지 URL을 찾지 못했습니다."
        );

    }


    console.log("");
    console.log("===== 첫 번째 우표 =====");
    console.log(`목록 제목: ${title}`);
    console.log(`상세 URL: ${detailUrl}`);
    console.log("");


    return {
        title,
        detailUrl
    };
}


// --------------------------------------------------
// 상세 페이지에서 데이터 추출
// --------------------------------------------------

function parseDetailPage(html, url, listTitle) {

    const $ = cheerio.load(html);


    const stamp = {

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


    // ------------------------------------------------
    // 제목
    // ------------------------------------------------

    /*
     * 상세 페이지의 h3 / h4 등을 우선 확인하고
     * 찾지 못하면 목록에서 가져온 제목 사용
     */

    const headings = $("h3, h4")
        .map((_, element) =>
            cleanText($(element).text())
        )
        .get()
        .filter(Boolean);


    /*
     * 상세 페이지에는 보통
     *
     * 보통우표
     * 또는
     * 나만의 우표
     *
     * 등의 분류명이 있고,
     * 목록 제목은 실제 디자인명일 수 있다.
     *
     * 우선 목록 제목을 사용한다.
     */

    stamp.title = listTitle;


    // ------------------------------------------------
    // 표 데이터 추출
    // ------------------------------------------------

    $("table tr").each(
        (_, row) => {

            const cells = $(row)
                .find("th, td")
                .map((_, cell) =>
                    cleanText(
                        $(cell).text()
                    )
                )
                .get()
                .filter(Boolean);


            if (cells.length < 2) {
                return;
            }


            const key = cells[0];
            const value = cells[1];


            if (key.includes("우표번호")) {

                stamp.id = value;

            }
            else if (key.includes("디자인")) {

                stamp.design = value;

            }
            else if (key.includes("발행일")) {

                stamp.issueDate =
                    normalizeDate(value);

            }
            else if (
                key.includes("액면가격") ||
                key.includes("액면가")
            ) {

                stamp.faceValue = value;

            }
            else if (key.includes("우표크기")) {

                stamp.size = value;

            }

        }
    );


    // ------------------------------------------------
    // 상세 설명
    // ------------------------------------------------

    /*
     * "상세설명"이라는 제목 이후의 텍스트를 찾는다.
     */

    $("*").each(
        (_, element) => {

            if (stamp.description) {
                return;
            }


            const text =
                cleanText(
                    $(element).text()
                );


            if (
                text === "상세설명"
            ) {

                const nextText =
                    cleanText(
                        $(element)
                            .next()
                            .text()
                    );


                if (nextText) {

                    stamp.description =
                        nextText;

                }

            }

        }
    );


    /*
     * 위 방법으로 못 찾은 경우
     * 상세 페이지 전체에서 상세설명 이후를
     * 찾는 보조 방법
     */

    if (!stamp.description) {

        const bodyText =
            cleanText(
                $("body").text()
            );

        const index =
            bodyText.indexOf("상세설명");


        if (index >= 0) {

            let text =
                bodyText.substring(
                    index + "상세설명".length
                );


            /*
             * 목록 / 하단 안내문 등이 붙는 경우 제거
             */

            text =
                text
                    .replace(
                        /목록.*$/s,
                        ""
                    )
                    .trim();


            if (text) {

                stamp.description =
                    text;

            }

        }

    }


    // ------------------------------------------------
    // 이미지
    // ------------------------------------------------

    /*
     * 우표 사진 이미지 찾기
     *
     * alt에 우표 관련 문구가 있는 이미지를 우선 사용
     */

    let imageUrl = "";


    $("img").each(
        (_, element) => {

            if (imageUrl) {
                return;
            }


            const src =
                $(element).attr("src");


            const alt =
                cleanText(
                    $(element).attr("alt")
                );


            if (!src) {
                return;
            }


            if (
                alt.includes("우표사진") ||
                alt.includes("우표 사진")
            ) {

                imageUrl =
                    toAbsoluteUrl(src);

            }

        }
    );


    /*
     * alt 조건으로 못 찾았을 경우
     * 상세 페이지의 이미지 중
     * 우표 이미지로 보이는 것을 보조 검색
     */

    if (!imageUrl) {

        $("img").each(
            (_, element) => {

                if (imageUrl) {
                    return;
                }


                const src =
                    $(element).attr("src") || "";


                const alt =
                    cleanText(
                        $(element).attr("alt")
                    );


                const combined =
                    `${src} ${alt}`.toLowerCase();


                if (
                    combined.includes("stamp") ||
                    combined.includes("smh") ||
                    combined.includes("우표")
                ) {

                    imageUrl =
                        toAbsoluteUrl(src);

                }

            }
        );

    }


    stamp.image = imageUrl;


    // ------------------------------------------------
    // 키워드
    // ------------------------------------------------

    stamp.keywords =
        makeKeywords(stamp);


    return stamp;
}


// --------------------------------------------------
// 키워드 생성
// --------------------------------------------------

function makeKeywords(stamp) {

    const keywords =
        new Set();


    const text = (

        stamp.title +
        " " +
        stamp.design +
        " " +
        stamp.description

    ).toLowerCase();


    /*
     * 기본적으로 디자인명을 키워드에 추가
     */

    if (stamp.design) {

        keywords.add(
            stamp.design
        );

    }


    /*
     * 검색용 키워드 사전
     */

    const dictionary = [

        "과일",
        "사과",
        "배",
        "감귤",
        "귤",
        "포도",
        "복숭아",
        "딸기",

        "꽃",
        "무궁화",
        "벚꽃",
        "매화",
        "장미",
        "백합",

        "동물",
        "호랑이",
        "사자",
        "곰",
        "두루미",
        "새",
        "고양이",
        "강아지",

        "자연",
        "산",
        "바다",
        "강",
        "섬",
        "숲",

        "한국",
        "서울",
        "제주",

        "역사",
        "인물",
        "문화",
        "문화재",
        "문화유산",

        "자동차",
        "기차",
        "철도",
        "교통",

        "스포츠",
        "축구",
        "야구",
        "KBO",

        "음식",
        "김치",
        "비빔밥",
        "전통",

        "과학",
        "우주",
        "별",

        "한글",
        "세종대왕",

        "태권도",
        "캐릭터",
        "여행",
        "관광"

    ];


    dictionary.forEach(
        keyword => {

            if (
                text.includes(
                    keyword.toLowerCase()
                )
            ) {

                keywords.add(keyword);

            }

        }
    );


    return Array.from(
        keywords
    );
}


// --------------------------------------------------
// JSON 저장
// --------------------------------------------------

function saveJson(data) {

    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(
            data,
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


// --------------------------------------------------
// 메인
// --------------------------------------------------

async function main() {

    try {

        console.log(
            "========================================"
        );

        console.log(
            "K-stamp 크롤링 테스트 시작"
        );

        console.log(
            "========================================"
        );


        // 1. 목록 페이지
        const listHtml =
            await fetchHtml(
                LIST_URL
            );


        console.log(
            "목록 페이지 수집 완료"
        );


        // 2. 첫 번째 상세 페이지
        const firstStamp =
            findFirstStampUrl(
                listHtml
            );


        // 3. 상세 페이지
        const detailHtml =
            await fetchHtml(
                firstStamp.detailUrl
            );


        console.log(
            "상세 페이지 수집 완료"
        );


        // 4. 데이터 추출
        const stamp =
            parseDetailPage(
                detailHtml,
                firstStamp.detailUrl,
                firstStamp.title
            );


        // 5. 결과 출력
        console.log("");
        console.log(
            "========== 수집 결과 =========="
        );

        console.log(
            JSON.stringify(
                stamp,
                null,
                2
            )
        );

        console.log(
            "================================"
        );


        // 6. JSON 저장
        saveJson([stamp]);


        console.log("");
        console.log(
            "✓ 테스트 완료"
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