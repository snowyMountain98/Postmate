const fs = require("fs");
const OpenAI = require("openai");


// ==================================================
// 기본 설정
// ==================================================

const INPUT_FILE =
    "stamp-data.json";


// 한 번에 처리할 우표 수
const BATCH_SIZE =
    Number(
        process.env.BATCH_SIZE || 20
    );


// 요청 사이 대기시간
const REQUEST_DELAY =
    Number(
        process.env.REQUEST_DELAY || 1000
    );


// OpenAI 모델
const MODEL =
    process.env.OPENAI_MODEL ||
    "gpt-5-mini";


// 재시도 횟수
const MAX_RETRIES =
    Number(
        process.env.MAX_RETRIES || 3
    );


// ==================================================
// OpenAI
// ==================================================

if (
    !process.env.OPENAI_API_KEY
) {

    console.error(
        "OPENAI_API_KEY가 설정되지 않았습니다."
    );

    process.exit(1);

}


const client =
    new OpenAI({
        apiKey:
            process.env.OPENAI_API_KEY
    });


// ==================================================
// sleep
// ==================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}


// ==================================================
// JSON 읽기
// ==================================================

function loadStamps() {

    if (
        !fs.existsSync(
            INPUT_FILE
        )
    ) {

        throw new Error(
            `${INPUT_FILE} 파일이 없습니다.`
        );

    }


    const data =
        JSON.parse(
            fs.readFileSync(
                INPUT_FILE,
                "utf8"
            )
        );


    if (
        !Array.isArray(data)
    ) {

        throw new Error(
            "stamp-data.json 형식이 올바르지 않습니다."
        );

    }


    return data;

}


// ==================================================
// JSON 저장
// ==================================================

function saveStamps(
    stamps
) {

    fs.writeFileSync(
        INPUT_FILE,
        JSON.stringify(
            stamps,
            null,
            2
        ),
        "utf8"
    );

}


// ==================================================
// 키워드 정리
// ==================================================

function cleanKeywords(
    keywords
) {

    if (
        !Array.isArray(
            keywords
        )
    ) {

        return [];

    }


    const result = [];


    keywords.forEach(
        keyword => {

            if (
                typeof keyword !==
                "string"
            ) {

                return;

            }


            const value =
                keyword
                    .trim()
                    .replace(
                        /^["'#]+|["']+$/g,
                        ""
                    );


            if (!value) {

                return;

            }


            if (
                !result.includes(
                    value
                )
            ) {

                result.push(
                    value
                );

            }

        }
    );


    return result.slice(
        0,
        10
    );

}


// ==================================================
// JSON 응답 파싱
// ==================================================

function parseKeywordResponse(
    text
) {

    let value =
        text.trim();


    // Markdown code fence 제거
    value =
        value.replace(
            /^```json\s*/i,
            ""
        );

    value =
        value.replace(
            /^```\s*/i,
            ""
        );

    value =
        value.replace(
            /\s*```$/i,
            ""
        );


    try {

        const parsed =
            JSON.parse(
                value
            );


        if (
            Array.isArray(
                parsed
            )
        ) {

            return cleanKeywords(
                parsed
            );

        }


        if (
            Array.isArray(
                parsed.keywords
            )
        ) {

            return cleanKeywords(
                parsed.keywords
            );

        }

    }
    catch {
        // 아래 fallback 처리
    }


    // JSON 파싱 실패 시
    // 쉼표 기준 fallback
    return cleanKeywords(
        value.split(",")
    );

}


// ==================================================
// AI 키워드 생성
// ==================================================

async function generateKeywords(
    stamp
) {

    if (
        !stamp.image
    ) {

        throw new Error(
            "이미지 URL이 없습니다."
        );

    }


    const prompt = `당신은 우표 이미지 분석 전문 AI입니다.

제공된 우표 이미지를 직접 분석하여
사용자가 우표를 검색할 때 도움이 되는 키워드를 생성하세요.

중요:
키워드는 우표의 텍스트나 설명만 분석해서 생성하지 말고,
반드시 우표 이미지에서 실제로 확인할 수 있는 시각적 요소를 중심으로 생성하세요.


[분석 대상]

이미지에서 다음 요소를 확인하세요.

- 인물
- 동물
- 식물
- 음식
- 건축물
- 문화재
- 캐릭터
- 스포츠
- 운동
- 차량
- 물건
- 자연
- 장소
- 국가
- 국기
- 행사
- 상징
- 종교
- 예술
- 기타 주요 시각적 요소


[상위 카테고리 생성]

이미지에서 확인한 구체적인 대상에 대해
사용자가 더 넓은 의미의 단어로 검색할 수 있도록
상위 카테고리도 함께 생성하세요.

예:

태극기
→ 국기
→ 국가
→ 대한민국

야구공 / 야구선수
→ 야구
→ 스포츠

부처님
→ 불교
→ 종교

사찰
→ 불교
→ 종교
→ 문화유산

자동차
→ 자동차
→ 교통

비행기
→ 비행기
→ 교통
→ 항공

꽃
→ 꽃
→ 식물

동물의 경우:
고양이
→ 고양이
→ 동물

호랑이
→ 호랑이
→ 동물

단, 실제 이미지에서 확인할 수 없는 상위 카테고리는
억지로 생성하지 마세요.


[색상 분석]

이미지에서 눈에 띄는 대표 색상을 분석하세요.

가능한 색상:

빨강
파랑
노랑
초록
주황
분홍
보라
갈색
검정
흰색
회색
금색
은색

이미지 전체에서 눈에 띄는 주요 색상만 선택하세요.

아주 작은 부분에만 존재하는 색상은 제외하세요.

색상은 최대 3개까지만 생성하세요.


[키워드 규칙]

1. 최대 10개의 키워드만 생성하세요.

2. 가장 중요한 키워드부터 순서대로 작성하세요.

3. 구체적인 대상과 상위 카테고리를 함께 포함하세요.

4. 검색에 유용한 일반적인 상위 개념을 포함하세요.

5. 같은 의미의 단어를 반복하지 마세요.

6. 이미지에서 확인할 수 없는 내용을 추측하지 마세요.

7. 제목이나 설명에만 존재하고 이미지에서 확인되지 않는 정보는
이미지 키워드로 생성하지 마세요.

8. 색상 키워드는 최대 3개까지만 포함하세요.

9. '우표', '기념우표', '발행'처럼 모든 우표에 적용될 수 있는
의미 없는 일반 단어는 제외하세요.


[예시 1]

이미지:
태극기가 크게 그려진 우표

출력:
[
  "태극기",
  "국기",
  "대한민국",
  "국가",
  "빨강",
  "파랑",
  "흰색"
]


[예시 2]

이미지:
야구선수와 야구공이 있는 우표

출력:
[
  "야구선수",
  "야구",
  "스포츠",
  "야구공",
  "운동",
  "빨강",
  "파랑"
]


[예시 3]

이미지:
부처님과 사찰이 있는 우표

출력:
[
  "부처님",
  "불교",
  "사찰",
  "종교",
  "문화유산",
  "금색",
  "갈색"
]


[예시 4]

이미지:
로보트태권V 캐릭터가 있는 우표

출력:
[
  "로보트태권V",
  "로봇",
  "애니메이션",
  "만화",
  "캐릭터",
  "태권도",
  "빨강",
  "파랑"
]


반드시 JSON 배열 하나만 출력하세요.

설명이나 Markdown은 출력하지 마세요.

[반드시 제외할 키워드]

다음 단어는 우표 검색에 의미가 없는 공통 단어이므로
절대로 최종 키워드에 포함하지 마세요.

- 대한민국
- 한국
- 우표
- KOREA
- Korea
- korea
- POST
- Post
- post
- KOREA POST
- Korea Post

대소문자 차이는 동일한 단어로 취급하세요.

예를 들어 이미지에 "KOREA POST"라는 글자가 보이더라도
"KOREA", "POST", "KOREA POST"를 키워드로 생성하지 마세요.

이미지에 태극기가 보이는 경우에는
"대한민국" 대신 다음과 같이 의미 있는 키워드를 사용할 수 있습니다.

- 태극기
- 국기
- 국가

단, "대한민국" 자체는 제외하세요.

[반드시 제외할 키워드 - 금액]

우표의 액면가와 관련된 정보는 검색 키워드로 사용하지 마세요.

다음과 같은 금액 표현을 모두 제외하세요.

- 원
- 원화
- KRW
- won
- W
- 10원
- 20원
- 30원
- 40원
- 50원
- 70원
- 80원
- 100원
- 150원
- 200원
- 300원
- 400원
- 430원
- 500원
- 600원
- 700원
- 800원
- 900원
- 1,000원
- 1,500원
- 2,000원
- 기타 숫자로 표현된 액면가

숫자와 금액 단위가 결합된 표현도 모두 제외하세요.

예:
"100원"
"430원"
"1,000원"
"₩1000"
"KRW 1000"

우표 이미지에 액면가가 표시되어 있더라도
이를 키워드로 생성하지 마세요.

단, 연도나 기념주년처럼 우표의 주제와 관련된 숫자는
금액이 아니므로 필요하다면 키워드로 사용할 수 있습니다.

예:
"50주년" → 허용
"1976년" → 필요할 경우 허용
"1000원" → 제외
`;


    for (
        let attempt = 0;
        attempt <= MAX_RETRIES;
        attempt++
    ) {

        try {

            console.log(
                `OpenAI 요청: ${stamp.id} / ${stamp.title}`
            );


            const response =
                await client.responses.create({

                    model:
                        MODEL,

                    input: [
                        {
                            role: "user",

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
                                        stamp.image
                                }

                            ]

                        }
                    ]

                });


            const text =
                response.output_text ||
                "";


            const keywords =
                parseKeywordResponse(
                    text
                );


            if (
                keywords.length === 0
            ) {

                throw new Error(
                    "AI가 키워드를 생성하지 않았습니다."
                );

            }


            return keywords;

        }
        catch (error) {

            console.error(
                `OpenAI 실패: ${stamp.id} / ${stamp.title}`
            );

            console.error(
                error.message
            );


            if (
                attempt <
                MAX_RETRIES
            ) {

                const waitTime =
                    3000 *
                    (attempt + 1);


                console.log(
                    `${waitTime / 1000}초 후 재시도...`
                );


                await sleep(
                    waitTime
                );

            }
            else {

                throw error;

            }

        }

    }


    return [];

}


// ==================================================
// 배치 처리
// ==================================================

async function processBatch(
    stamps,
    startIndex
) {

    const batch =
        stamps.slice(
            startIndex,
            startIndex +
                BATCH_SIZE
        );


    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        `배치 처리: ${
            startIndex + 1
        } ~ ${
            startIndex + batch.length
        }`
    );

    console.log(
        `배치 크기: ${batch.length}`
    );

    console.log(
        "========================================"
    );


    for (
        let i = 0;
        i < batch.length;
        i++
    ) {

        const stamp =
            batch[i];


        const globalIndex =
            startIndex + i + 1;


        console.log("");
        console.log(
            `[${globalIndex}/${stamps.length}] ${stamp.id} / ${stamp.title}`
        );


        // 이미 키워드가 있으면 건너뜀
/*        if (
            Array.isArray(
                stamp.keywords
            ) &&
            stamp.keywords.length > 0
        ) {

            console.log(
                "→ 기존 키워드 존재: 건너뜀"
            );

            continue;

        }
*/

        try {

            const keywords =
                await generateKeywords(
                    stamp
                );


            stamp.keywords =
                keywords;


            console.log(
                `✓ 키워드: ${keywords.join(", ")}`
            );


            // 한 건 처리할 때마다 저장
            // 중간 실패 시 진행상황 보존
            saveStamps(
                stamps
            );


        }
        catch (error) {

            console.error(
                `❌ ${stamp.id} 처리 실패`
            );

            console.error(
                error.message
            );


            // 실패한 우표는 keywords=[]
            // 다음 실행에서 다시 시도
            stamp.keywords =
                [];


            saveStamps(
                stamps
            );


            console.log(
                "→ 실패한 우표는 건너뛰고 계속 진행합니다."
            );

        }


        await sleep(
            REQUEST_DELAY
        );

    }

}


// ==================================================
// 메인
// ==================================================

async function main() {

    console.log(
        "========================================"
    );

    console.log(
        "K-stamp OpenAI Vision 키워드 생성"
    );

    console.log(
        "========================================"
    );


    console.log("");
    console.log(
        `모델: ${MODEL}`
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


    const stamps =
        loadStamps();


    console.log("");
    console.log(
        `전체 우표: ${stamps.length}개`
    );


    const pending =
        stamps.filter(
            stamp =>
                !Array.isArray(
                    stamp.keywords
                ) ||
                stamp.keywords.length === 0
        );


    console.log(
        `키워드 미생성: ${pending.length}개`
    );

    console.log(
        `키워드 완료: ${
            stamps.length -
            pending.length
        }개`
    );


    if (
        pending.length === 0
    ) {

        console.log("");
        console.log(
            "모든 우표의 키워드가 이미 생성되어 있습니다."
        );

        return;

    }


    // ==================================================
    // 미완료 우표만 처리
    // ==================================================

    for (
        let i = 0;
        i < pending.length;
        i += BATCH_SIZE
    ) {

        await processBatch(
            pending,
            i
        );


        console.log("");
        console.log(
            `전체 진행률: ${
                Math.min(
                    i + BATCH_SIZE,
                    pending.length
                )
            }/${pending.length}`
        );

    }


    // ==================================================
    // 최종 저장
    // ==================================================

    saveStamps(
        stamps
    );


    const completed =
        stamps.filter(
            stamp =>
                Array.isArray(
                    stamp.keywords
                ) &&
                stamp.keywords.length > 0
        );


    const failed =
        stamps.filter(
            stamp =>
                !Array.isArray(
                    stamp.keywords
                ) ||
                stamp.keywords.length === 0
        );


    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "✓ 키워드 생성 완료"
    );

    console.log(
        `전체: ${stamps.length}개`
    );

    console.log(
        `완료: ${completed.length}개`
    );

    console.log(
        `미완료: ${failed.length}개`
    );

    console.log(
        "========================================"
    );


    if (
        failed.length > 0
    ) {

        console.log("");
        console.log(
            "미완료 우표는 다음 실행에서 다시 처리됩니다."
        );

        failed.forEach(
            stamp => {

                console.log(
                    `- ${stamp.id} / ${stamp.title}`
                );

            }
        );

    }

}


main()
    .catch(
        error => {

            console.error("");
            console.error(
                "❌ 키워드 생성 실패"
            );

            console.error(
                error
            );


            process.exit(1);

        }
    );