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
    process.env.BATCH_SIZE || 1000
);

// API 호출 사이 대기시간
// 너무 빠르게 여러 요청을 보내지 않도록 함
const REQUEST_DELAY = Number(
    process.env.REQUEST_DELAY || 3000
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

당신은 대한민국 우표 검색 서비스의 검색 키워드를 만드는 전문가입니다.

아래 우표 정보를 분석하여 사용자가 이 우표를 찾을 때
입력할 가능성이 높은 검색 키워드를 최대 10개 생성하세요.

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

===== 키워드 생성 목적 =====

이 키워드는 우표 검색 서비스에서 사용됩니다.

사용자가 우표의 정확한 제목을 모르더라도
"애니메이션", "로봇", "야구", "스포츠", "불교",
"문화유산"과 같은 관련 주제나 소재를 검색했을 때
해당 우표를 찾을 수 있도록 만드는 것이 목적입니다.

===== 키워드 생성 규칙 =====

1. 최대 10개의 키워드를 생성하세요.

2. 단순히 상세설명에 등장한 단어를 그대로 뽑지 마세요.
   우표의 전체적인 주제와 소재를 이해한 후
   검색에 유용한 키워드를 생성하세요.

3. 반드시 다음 유형의 키워드를 고려하세요.

   * 우표의 핵심 주제
   * 상위 카테고리
   * 관련 분야
   * 작품/콘텐츠의 종류
   * 주요 소재
   * 등장인물 또는 캐릭터
   * 관련 문화
   * 역사적 의미
   * 스포츠 종목
   * 동물/식물 종류
   * 종교/문화 관련 개념
   * 기관/단체
   * 장소
   * 문화유산
   * 사용자가 실제로 검색할 가능성이 높은 일반적인 표현

4. 구체적인 키워드와 넓은 범주의 키워드를 함께 생성하세요.

   예:

   로보트태권V
   → 로보트태권V
   → 애니메이션
   → 만화
   → 로봇
   → 캐릭터
   → 태권도
   → 한국 애니메이션

   KBO 관련 우표
   → KBO
   → 야구
   → 스포츠
   → 프로야구
   → 한국 프로야구
   → 야구선수

   불교 관련 문화유산 우표
   → 유네스코
   → 불교
   → 부처님
   → 문화유산
   → 세계유산
   → 사찰

5. 우표의 핵심 소재가 무엇인지 먼저 판단하세요.

   예를 들어:

   * 로봇 애니메이션이라면
     "애니메이션", "만화", "로봇" 등을 고려합니다.

   * 야구 관련 우표라면
     "스포츠", "야구", "프로야구" 등을 고려합니다.

   * 불교 관련 문화유산이라면
     "불교", "부처님", "유네스코", "문화유산",
     "세계유산" 등을 고려합니다.

   * 꽃 우표라면
     "꽃", "식물", "자연"과 함께 실제 꽃 이름을 고려합니다.

   * 동물 우표라면
     "동물", "야생동물", "포유류" 등과 함께
     실제 동물 이름을 고려합니다.

6. 검색어로 사용할 수 있도록 너무 세부적인 문장이나
   긴 표현은 피하세요.

   좋은 예:
   "야구"
   "스포츠"
   "애니메이션"
   "로봇"
   "불교"
   "문화유산"

   좋지 않은 예:
   "1976년에 처음 개봉한 대한민국 대표 애니메이션"

7. 우표와 직접적인 관련이 없는 일반적인 단어는 제외하세요.

   다음과 같은 단어는 특별한 의미가 없는 한 사용하지 마세요.

   * 우표
   * 기념우표
   * 발행
   * 발행일
   * 가격
   * 액면가
   * 크기
   * 대한민국
   * 한국

8. 단, "한국 애니메이션", "한국 프로야구"처럼
   해당 우표의 주제를 구체적으로 설명하는 표현이라면 사용할 수 있습니다.

9. 상세설명에 명시되어 있거나 우표 제목/디자인을 통해
   명확하게 확인할 수 있는 내용만 사용하세요.

10. 사실에 없는 내용을 추측해서 생성하지 마세요.

11. 같은 의미의 키워드를 불필요하게 반복하지 마세요.

12. 키워드는 중요도가 높은 순서대로 정렬하세요.

13. 한국어 검색을 기준으로 작성하세요.

14. 검색 사용자가 실제로 입력할 법한 표현을 우선하세요.

===== 최종 출력 형식 =====

반드시 JSON 배열만 반환하세요.

설명이나 문장은 절대 추가하지 마세요.

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