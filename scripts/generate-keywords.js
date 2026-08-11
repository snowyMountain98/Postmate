const fs = require("fs");
const OpenAI = require("openai");

// ==================================================
// 기본 설정
// ==================================================

const INPUT_FILE = "stamp-data.json";
const OUTPUT_FILE = "stamp-data.json";

// OpenAI 모델
const OPENAI_MODEL = "gpt-5-mini";

// 한 번 실행할 때 처리할 우표 개수
//
// 예:
// 20 → 한 번 실행할 때 최대 20개
// 50 → 한 번 실행할 때 최대 50개
//
// 기본값: 20
const BATCH_SIZE = Number(
    process.env.BATCH_SIZE || 20
);

// API 호출 사이 대기시간
// 너무 빠르게 여러 요청을 보내지 않도록 함
const REQUEST_DELAY = Number(
    process.env.REQUEST_DELAY || 1000
);

// API 오류 발생 시 재시도 횟수
const MAX_RETRIES = Number(
    process.env.MAX_RETRIES || 3
);


// ==================================================
// sleep
// ==================================================

function sleep(ms) {

    return new Promise(
        resolve => setTimeout(resolve, ms)
    );

}


// ==================================================
// JSON 읽기
// ==================================================

function loadStampData() {

    if (!fs.existsSync(INPUT_FILE)) {

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

    if (!Array.isArray(data)) {

        throw new Error(
            `${INPUT_FILE}의 형식이 배열이 아닙니다.`
        );

    }

    return data;

}


// ==================================================
// JSON 저장
// ==================================================

function saveStampData(data) {

    fs.writeFileSync(

        OUTPUT_FILE,

        JSON.stringify(
            data,
            null,
            2
        ),

        "utf8"

    );

}


// ==================================================
// OpenAI Client
// ==================================================

function createOpenAIClient() {

    const apiKey =
        process.env.OPENAI_API_KEY;

    if (!apiKey) {

        throw new Error(
            "OPENAI_API_KEY 환경변수가 없습니다."
        );

    }

    return new OpenAI({
        apiKey
    });

}


// ==================================================
// 키워드가 이미 있는지 확인
// ==================================================

function hasKeywords(stamp) {

    return (

        Array.isArray(
            stamp.keywords
        ) &&

        stamp.keywords.length > 0

    );

}


// ==================================================
// AI 입력 생성
// ==================================================

function createPrompt(stamp) {

    return `
다음은 대한민국 우표의 정보입니다.

[우표 제목]
${stamp.title || ""}

[디자인]
${stamp.design || ""}

[발행일]
${stamp.issueDate || ""}

[액면가격]
${stamp.faceValue || ""}

[우표크기]
${stamp.size || ""}

[상세설명]
${stamp.description || ""}


이 우표를 검색하는 사용자가 입력할 가능성이 높은
한국어 검색 키워드를 최대 10개 생성하세요.

키워드는 우표 검색 시스템에서 사용됩니다.

조건:

1. 반드시 한국어로 작성하세요.
2. 우표의 실제 소재와 직접 관련된 단어만 사용하세요.
3. 제목에 포함된 중요한 단어를 포함하세요.
4. 디자인의 주요 소재를 포함하세요.
5. 상세설명에서 등장하는 중요한 인물, 캐릭터, 장소,
   문화, 역사, 동물, 식물, 작품명 등을 고려하세요.
6. 사용자가 검색할 가능성이 높은 순서대로 작성하세요.
7. 같은 의미의 단어를 중복해서 넣지 마세요.
8. 너무 일반적인 단어는 제외하세요.
9. "우표", "발행", "발행일", "가격", "크기" 같은
   메타데이터는 제외하세요.
10. 사실에 없는 내용을 추측해서 추가하지 마세요.
11. 최대 10개까지만 생성하세요.
12. 결과는 키워드 문자열 배열만 반환하세요.

예:

[
  "로보트태권V",
  "한국 애니메이션",
  "태권도",
  "훈이",
  "영희",
  "김박사",
  "윤박사",
  "깡통철이",
  "원형 딱지",
  "디지털 복원"
]
`;

}


// ==================================================
// OpenAI 호출
// ==================================================

async function requestKeywords(
    client,
    stamp
) {

    const prompt =
        createPrompt(stamp);

    const response =
        await client.responses.create({

            model:
                OPENAI_MODEL,

            input:
                prompt,

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
        output.trim();

    // Markdown 코드 블록 제거
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

    }
    catch {

        // 응답에 다른 텍스트가 섞여 있는 경우
        const start =
            output.indexOf("[");

        const end =
            output.lastIndexOf("]");

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


    // 문자열만 사용
    keywords =
        keywords
            .filter(
                keyword =>
                    typeof keyword === "string"
            )
            .map(
                keyword =>
                    keyword.trim()
            )
            .filter(Boolean);


    // 중복 제거
    keywords =
        Array.from(
            new Set(
                keywords
            )
        );


    // 최대 10개
    keywords =
        keywords.slice(
            0,
            10
        );


    return keywords;

}


// ==================================================
// 재시도
// ==================================================

async function requestKeywordsWithRetry(
    client,
    stamp
) {

    for (
        let attempt = 1;
        attempt <= MAX_RETRIES;
        attempt++
    ) {

        try {

            return await requestKeywords(
                client,
                stamp
            );

        }
        catch (error) {

            console.error(
                `API 오류 (${attempt}/${MAX_RETRIES}): ${error.message}`
            );


            // 크레딧 부족은 재시도해도 해결되지 않음
            if (
                error.status === 429 &&
                (
                    error.code ===
                    "insufficient_quota" ||

                    error.code ===
                    "credit_balance_exhausted"
                )
            ) {

                throw error;

            }


            if (
                attempt >= MAX_RETRIES
            ) {

                throw error;

            }


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


// ==================================================
// 메인
// ==================================================

async function main() {

    console.log(
        "========================================"
    );

    console.log(
        "K-stamp AI 키워드 생성"
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


    // ------------------------------------------------
    // 1. 데이터 읽기
    // ------------------------------------------------

    const stamps =
        loadStampData();


    console.log(
        `전체 우표: ${stamps.length}개`
    );


    // ------------------------------------------------
    // 2. 아직 키워드가 없는 우표 찾기
    // ------------------------------------------------

    const pending =
        stamps.filter(
            stamp =>
                !hasKeywords(stamp)
        );


    console.log(
        `키워드 미생성: ${pending.length}개`
    );


    // ------------------------------------------------
    // 모두 처리된 경우
    // ------------------------------------------------

    if (
        pending.length === 0
    ) {

        console.log(
            "모든 우표에 키워드가 이미 생성되어 있습니다."
        );

        return;

    }


    // ------------------------------------------------
    // 3. 이번 실행에서 처리할 우표
    // ------------------------------------------------

    const targets =
        pending.slice(
            0,
            BATCH_SIZE
        );


    console.log(
        `이번 실행 처리 대상: ${targets.length}개`
    );


    // ------------------------------------------------
    // 4. OpenAI
    // ------------------------------------------------

    const client =
        createOpenAIClient();


    let success =
        0;

    let failed =
        0;


    // ------------------------------------------------
    // 5. 하나씩 처리
    // ------------------------------------------------

    for (
        let i = 0;
        i < targets.length;
        i++
    ) {

        const stamp =
            targets[i];


        const index =
            stamps.indexOf(
                stamp
            );


        console.log("");
        console.log(
            "----------------------------------------"
        );

        console.log(
            `[${i + 1}/${targets.length}]`
        );

        console.log(
            `ID: ${stamp.id}`
        );

        console.log(
            `제목: ${stamp.title}`
        );


        try {

            const keywords =
                await requestKeywordsWithRetry(
                    client,
                    stamp
                );


            stamp.keywords =
                keywords;


            success++;


            console.log(
                `✓ 키워드 생성 성공`
            );

            console.log(
                JSON.stringify(
                    keywords,
                    null,
                    2
                )
            );


            /*
             * 한 건 성공할 때마다 즉시 저장
             *
             * GitHub Actions가 중간에 종료되어도
             * 이미 성공한 데이터는 보존됨.
             */

            saveStampData(
                stamps
            );


            console.log(
                `✓ ${OUTPUT_FILE} 저장 완료`
            );


        }
        catch (error) {

            failed++;


            console.error(
                `✗ 키워드 생성 실패`
            );

            console.error(
                error.message
            );


            /*
             * 실패한 우표는 keywords=[]
             * 그대로 둔다.
             *
             * 다음 실행에서 다시 처리된다.
             */

            stamp.keywords =
                [];


            /*
             * 현재까지 성공한 데이터 저장
             */

            saveStampData(
                stamps
            );


            /*
             * 크레딧 부족이면 더 진행해도
             * 전부 실패하므로 즉시 종료
             */

            if (
                error.status === 429 &&
                (
                    error.code ===
                    "insufficient_quota" ||

                    error.code ===
                    "credit_balance_exhausted"
                )
            ) {

                throw new Error(
                    "OpenAI API 크레딧이 부족합니다. 현재까지 처리한 데이터는 저장되었습니다."
                );

            }

        }


        // ------------------------------------------------
        // 다음 요청 전 대기
        // ------------------------------------------------

        if (
            i <
            targets.length - 1
        ) {

            await sleep(
                REQUEST_DELAY
            );

        }

    }


    // ------------------------------------------------
    // 6. 결과
    // ------------------------------------------------

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "처리 완료"
    );

    console.log(
        `성공: ${success}`
    );

    console.log(
        `실패: ${failed}`
    );

    console.log(
        `남은 우표: ${Math.max(0, pending.length - targets.length)}`
    );

    console.log(
        "========================================"
    );

}


// ==================================================
// 실행
// ==================================================

main()
    .catch(
        error => {

            console.error("");
            console.error(
                "❌ 키워드 생성 작업 실패"
            );

            console.error(
                error
            );

            process.exit(1);

        }
    );