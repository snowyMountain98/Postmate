const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// ============================================================
// 설정
// ============================================================

const DATA_FILE =
path.join(
__dirname,
"..",
"stamp-data.json"
);

// 한 번에 처리할 우표 수
const BATCH_SIZE =
Number(
process.env.BATCH_SIZE || 20
);

// 요청 사이 대기
const REQUEST_DELAY =
Number(
process.env.REQUEST_DELAY || 1000
);

// 실패 재시도
const MAX_RETRIES =
Number(
process.env.MAX_RETRIES || 3
);

// OpenAI 모델
const OPENAI_MODEL =
process.env.OPENAI_MODEL ||
"gpt-5-mini";

// OpenAI
const client =
new OpenAI({
apiKey:
process.env.OPENAI_API_KEY
});

// ============================================================
// 기본 함수
// ============================================================

function sleep(ms) {


return new Promise(
    resolve =>
        setTimeout(
            resolve,
            ms
        )
);


}

// ============================================================
// 데이터 읽기
// ============================================================

function loadStampData() {


if (
    !fs.existsSync(
        DATA_FILE
    )
) {

    throw new Error(
        `파일을 찾을 수 없습니다: ${DATA_FILE}`
    );

}


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

    throw new Error(
        "stamp-data.json의 형식이 배열이 아닙니다."
    );

}


return data;


}

// ============================================================
// 데이터 저장
// ============================================================

function saveStampData(data) {


fs.writeFileSync(

    DATA_FILE,

    JSON.stringify(
        data,
        null,
        2
    ),

    "utf8"

);


}

// ============================================================
// 이미지 URL
// ============================================================

function normalizeImageUrl(url) {


if (!url) {
    return "";
}


let imageUrl =
    String(url).trim();


if (
    imageUrl.startsWith(
        "http://"
    )
) {

    imageUrl =
        imageUrl.replace(
            "http://",
            "https://"
        );

}


return imageUrl;


}

// ============================================================
// 키워드 정리
// ============================================================

function normalizeKeywords(value) {


let keywords = [];


if (
    Array.isArray(value)
) {

    keywords =
        value;

}
else if (
    typeof value === "string"
) {

    try {

        const parsed =
            JSON.parse(value);


        if (
            Array.isArray(parsed)
        ) {

            keywords =
                parsed;

        }
        else {

            keywords =
                value
                    .split(",")
                    .map(
                        v => v.trim()
                    );

        }

    }
    catch {

        keywords =
            value
                .split(",")
                .map(
                    v => v.trim()
                );

    }

}


return [
    ...new Set(
        keywords
            .map(
                keyword =>
                    String(keyword)
                        .trim()
                        .replace(
                            /^["']|["']$/g,
                            ""
                        )
            )
            .filter(Boolean)
    )
].slice(
    0,
    10
);


}

// ============================================================
// AI Prompt
// ============================================================

function createPrompt(stamp) {


return `


당신은 대한민국 우표 검색 서비스의 AI 키워드 생성 전문가입니다.

사용자가 우표의 정확한 제목을 몰라도
우표의 소재, 주제, 분야, 이미지에 등장하는 대상을
검색해서 해당 우표를 찾을 수 있도록
검색용 키워드를 생성하세요.

제목:
${stamp.title || ""}

디자인:
${stamp.design || ""}

발행일:
${stamp.issueDate || ""}

액면가격:
${stamp.faceValue || ""}

크기:
${stamp.size || ""}

상세설명:
${stamp.description || ""}

첨부된 우표 이미지를 반드시 분석하세요.

특히 이미지에서 실제로 확인할 수 있는
다음 요소를 적극적으로 활용하세요.

인물
동물
식물
음식
스포츠
건축물
문화유산
자연
장소
캐릭터
물건
상징물
글자
로고
기관
행사
작품

사용자가 실제로 검색할 가능성이 높은
짧은 명사 또는 명사구를 생성하세요.

예를 들어:

로보트태권V 우표:
로보트태권V
애니메이션
만화
로봇
캐릭터
태권도
한국 애니메이션

KBO 우표:
KBO
야구
스포츠
프로야구
한국 프로야구
야구선수
야구장

유네스코 및 불교 문화유산:
유네스코
불교
부처님
문화유산
세계유산
불교문화
사찰

사과가 그려진 우표:
사과
과일
과일우표
식물
농산물

규칙:

1. 최대 10개까지만 생성하세요.
2. 중요도가 높은 순서대로 작성하세요.
3. 구체적인 키워드와 상위 개념 키워드를 함께 생성하세요.
4. 이미지에서 확인되는 내용을 적극적으로 활용하세요.
5. 제목, 디자인, 설명도 함께 활용하세요.
6. 이미지와 설명이 다르면 둘을 종합해서 판단하세요.
7. 사용자가 검색할 가능성이 높은 단어를 우선하세요.
8. 너무 긴 문장은 사용하지 마세요.
9. 같은 의미의 키워드를 반복하지 마세요.
10. 모든 우표에 공통되는 "우표", "기념우표", "발행일", "액면가", "크기"는 제외하세요.
11. "한국" 단독 키워드는 가급적 제외하세요.
12. 이미지에 존재하지 않는 대상을 추측하지 마세요.
13. 불확실한 내용은 키워드로 만들지 마세요.
14. 명확한 고유명사는 포함하세요.
15. 넓은 범주의 검색도 가능하도록 상위 카테고리를 포함하세요.
16. 검색에 실제로 도움이 되는 단어를 우선하세요.

반드시 JSON 배열만 반환하세요.

설명이나 마크다운은 절대 추가하지 마세요.

예:

[
"로보트태권V",
"애니메이션",
"만화",
"로봇",
"캐릭터",
"태권도",
"한국 애니메이션"
]

`;

}

// ============================================================
// OpenAI Vision
// ============================================================

async function generateKeywords(stamp) {

`
const imageUrl =
    normalizeImageUrl(
        stamp.image
    );


if (!imageUrl) {

    throw new Error(
        "우표 이미지 URL이 없습니다."
    );

}


const prompt =
    createPrompt(
        stamp
    );


const response =
    await client.responses.create({

        model:
            OPENAI_MODEL,

        store:
            false,

        input: [

            {

                role:
                    "user",

                content: [

                    {

                        type:
                            "input_text",

                        text:
                            prompt

                    },

                    {

                        type:
                            "input_image",

                        image_url:
                            imageUrl,

                        detail:
                            "high"

                    }

                ]

            }

        ]

    });


const output =
    response.output_text;


if (!output) {

    throw new Error(
        "OpenAI 응답이 비어 있습니다."
    );

}


let jsonText =
    output.trim();


jsonText =
    jsonText
        .replace(
            /^json\s*/i,
            ""
        )
        .replace(
            /^\s*/i,
            ""
        )
        .replace(
            /\s*$/i,
            ""
        )
        .trim();


const start =
    jsonText.indexOf("[");


const end =
    jsonText.lastIndexOf("]");


if (
    start !== -1 &&
    end !== -1 &&
    end > start
) {

    jsonText =
        jsonText.substring(
            start,
            end + 1
        );

}


let keywords;


try {

    keywords =
        JSON.parse(
            jsonText
        );

}
catch {

    throw new Error(
        `AI 응답 JSON 변환 실패: ${jsonText}`
    );

}


keywords =
    normalizeKeywords(
        keywords
    );


if (
    keywords.length === 0
) {

    throw new Error(
        "생성된 키워드가 없습니다."
    );

}


return keywords;
`

}

// ============================================================
// 재시도
// ============================================================

async function generateKeywordsWithRetry(
stamp
) {


let lastError;


for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
) {

    try {

        console.log(
            `AI 요청 ${attempt}/${MAX_RETRIES}`
        );


        return await generateKeywords(
            stamp
        );

    }
    catch (error) {

        lastError =
            error;


        console.error(
            `AI 요청 실패 (${attempt}/${MAX_RETRIES})`
        );


        console.error(
            error.message
        );


        if (
            attempt < MAX_RETRIES
        ) {

            const waitTime =
                attempt * 3000;


            console.log(
                `${waitTime / 1000}초 후 재시도...`
            );


            await sleep(
                waitTime
            );

        }

    }

}


throw lastError;


}

// ============================================================
// 키워드 생성 대상
// ============================================================

function getPendingStamps(
stamps
) {


return stamps.filter(
    stamp =>
        !(
            Array.isArray(
                stamp.keywords
            ) &&
            stamp.keywords.length > 0
        )
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
    "K-stamp AI 이미지 키워드 생성"
);

console.log(
    "========================================"
);


console.log(
    `모델: ${OPENAI_MODEL}`
);

console.log(
    `배치 크기: ${BATCH_SIZE}`
);

console.log(
    `요청 간 대기: ${REQUEST_DELAY}ms`
);

console.log(
    `최대 재시도: ${MAX_RETRIES}`
);


if (
    !process.env.OPENAI_API_KEY
) {

    throw new Error(
        "OPENAI_API_KEY 환경변수가 설정되지 않았습니다."
    );

}


const stamps =
    loadStampData();


console.log(
    `전체 우표: ${stamps.length}개`
);


let totalSuccess = 0;
let totalFail = 0;
let batchNumber = 0;


// ========================================================
// 전체 미처리 우표가 없어질 때까지 반복
// ========================================================

while (true) {

    const pending =
        getPendingStamps(
            stamps
        );


    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        `남은 미처리 우표: ${pending.length}개`
    );

    console.log(
        "========================================"
    );


    if (
        pending.length === 0
    ) {

        console.log(
            "🎉 모든 우표의 키워드 생성이 완료되었습니다."
        );

        break;

    }


    batchNumber++;


    const targets =
        pending.slice(
            0,
            BATCH_SIZE
        );


    console.log(
        `배치 ${batchNumber}: ${targets.length}개 처리`
    );


    let batchSuccess = 0;
    let batchFail = 0;


    // ====================================================
    // 현재 배치
    // ====================================================

    for (
        let i = 0;
        i < targets.length;
        i++
    ) {

        const stamp =
            targets[i];


        console.log("");
        console.log(
            "----------------------------------------"
        );

        console.log(
            `[배치 ${batchNumber}] ${i + 1}/${targets.length}`
        );

        console.log(
            `ID: ${stamp.id || ""}`
        );

        console.log(
            `제목: ${stamp.title || ""}`
        );


        try {

            const keywords =
                await generateKeywordsWithRetry(
                    stamp
                );


            stamp.keywords =
                keywords;


            batchSuccess++;
            totalSuccess++;


            console.log(
                "✓ 키워드 생성 성공"
            );

            console.log(
                keywords.join(
                    ", "
                )
            );


            // 성공 즉시 저장
            saveStampData(
                stamps
            );


            console.log(
                "✓ stamp-data.json 저장"
            );

        }
        catch (error) {

            batchFail++;
            totalFail++;


            console.error(
                "❌ 키워드 생성 실패"
            );

            console.error(
                error.message
            );


            /*
             * keywords를 변경하지 않음.
             *
             * 따라서 다음 실행/재시도에서
             * 다시 처리할 수 있음.
             */

        }


        if (
            i <
            targets.length - 1
        ) {

            await sleep(
                REQUEST_DELAY
            );

        }

    }


    console.log("");
    console.log(
        `배치 ${batchNumber} 완료`
    );

    console.log(
        `성공: ${batchSuccess}`
    );

    console.log(
        `실패: ${batchFail}`
    );


    // ----------------------------------------------------
    // 중요:
    // 한 배치에서 전부 실패했다면 무한 반복 방지
    // ----------------------------------------------------

    if (
        batchSuccess === 0
    ) {

        console.error("");
        console.error(
            "이번 배치에서 성공한 우표가 없습니다."
        );

        console.error(
            "OpenAI API 또는 이미지 URL 문제일 수 있습니다."
        );

        console.error(
            "현재까지 성공한 데이터만 저장하고 종료합니다."
        );

        break;

    }

}


// ========================================================
// 최종 저장
// ========================================================

saveStampData(
    stamps
);


const remaining =
    getPendingStamps(
        stamps
    );


console.log("");
console.log(
    "========================================"
);

console.log(
    "AI 키워드 생성 최종 결과"
);

console.log(
    "========================================"
);

console.log(
    `전체 우표: ${stamps.length}개`
);

console.log(
    `성공: ${totalSuccess}개`
);

console.log(
    `실패: ${totalFail}개`
);

console.log(
    `남은 미처리: ${remaining.length}개`
);

console.log(
    "========================================"
);


// 일부 실패가 있어도
// 성공한 데이터는 배포 가능하므로
// workflow 자체는 실패시키지 않음.


}

main()
.catch(error => {


    console.error("");
    console.error(
        "❌ 키워드 생성 실패"
    );

    console.error(
        error
    );

    process.exit(1);

});

