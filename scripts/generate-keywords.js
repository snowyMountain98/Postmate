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


    const prompt = `당신은 대한민국 우표 전문 데이터 큐레이터입니다.

제공된 우표 이미지와 우표 정보를 분석해서
사용자가 우표를 검색할 때 도움이 되는 검색 키워드를 생성하세요.

[우표 정보]

제목:
${stamp.title || ""}

디자인:
${stamp.design || ""}

발행일:
${stamp.issueDate || ""}

액면가:
${stamp.faceValue || ""}

크기:
${stamp.size || ""}

설명:
${stamp.description || ""}


[키워드 생성 목적]

사용자가 다음과 같이 검색했을 때
해당 우표가 검색될 수 있도록 의미 있는 검색 키워드를 만들어야 합니다.

예를 들어 로보트태권V 우표라면:

- 로보트태권V
- 애니메이션
- 만화
- 로봇
- 태권도
- 캐릭터
- 한국 애니메이션

등이 될 수 있습니다.

KBO 관련 우표라면:

- KBO
- KBO 리그
- 스포츠
- 야구
- 프로야구
- 야구선수

등이 될 수 있습니다.

유네스코 또는 문화유산 관련 우표라면 이미지와 설명을 분석해서:

- 유네스코
- 세계유산
- 문화유산
- 불교
- 사찰
- 부처님

등 실제로 관련 있는 검색어를 생성할 수 있습니다.


[이미지 분석]

반드시 우표 이미지를 직접 확인하세요.

이미지에 실제로 보이는 다음 요소를 분석하세요.

- 인물
- 동물
- 식물
- 건축물
- 문화재
- 캐릭터
- 스포츠
- 음식
- 자연
- 지역
- 국가
- 행사
- 상징물
- 문자
- 로고
- 기타 중요한 시각적 요소


[색상 분석]

우표 이미지에서 눈에 띄는 대표 색상도 검색 키워드로 포함하세요.

사용할 수 있는 색상 예:

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

단, 아주 작은 부분에만 사용된 색상은 제외하세요.

이미지 전체에서 실제로 눈에 띄는 주요 색상만 선택하세요.

색상 키워드는 최대 3개까지만 포함하세요.


[키워드 규칙]

1. 최대 10개의 키워드만 생성하세요.

2. 가장 중요한 키워드부터 순서대로 작성하세요.

3. 제목에 있는 핵심 단어를 필요하면 포함하세요.

4. 이미지에서 실제로 확인할 수 있는 대상을 적극적으로 반영하세요.

5. 설명에서 중요한 주제도 반영하세요.

6. 사용자가 일반적인 단어로 검색해도 찾을 수 있도록 상위 개념을 포함하세요.

예:
야구 → 스포츠
로보트태권V → 애니메이션, 만화, 로봇
사찰 → 불교, 문화유산
부처님 → 불교

7. 너무 일반적인 의미 없는 단어는 제외하세요.

예:
우표
기념
발행
한국

이런 단어는 해당 우표의 검색에 특별한 도움이 되지 않는다면 제외하세요.

8. 이미지에서 확인되지 않는 내용을 추측해서 만들지 마세요.

9. 색상은 최대 3개까지만 포함하세요.

10. 서로 의미가 거의 같은 단어를 반복하지 마세요.


[출력 형식]

반드시 JSON 배열 하나만 출력하세요.

예:

["로보트태권V","애니메이션","만화","로봇","태권도","캐릭터","한국 애니메이션","빨강","파랑","노랑"]

설명이나 Markdown은 출력하지 마세요.
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