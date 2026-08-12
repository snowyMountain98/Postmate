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


    const prompt = `이미지를 분석하여 우표 검색에 사용할 수 있는
시각적 키워드를 최대 10개 생성하세요.

다음 요소를 분석하세요.

- 인물
- 동물
- 식물
- 음식
- 건축물
- 문화재
- 캐릭터
- 스포츠
- 물건
- 자연
- 장소
- 로고
- 문자
- 대표 색상

이미지에서 실제로 확인할 수 있는 것만 작성하세요.

추측하지 마세요.

대표 색상은 최대 3개까지만 작성하세요.

제목이나 설명에만 존재하고 이미지에서 확인할 수 없는
정보는 키워드로 생성하지 마세요.

예:

로보트태권V 이미지라면

[
  "로봇",
  "애니메이션",
  "캐릭터",
  "태권도",
  "빨강",
  "파랑"
]

반드시 JSON 배열만 반환하세요.
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
        if (
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