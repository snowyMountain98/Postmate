const fs = require("fs");
const OpenAI = require("openai");

const INPUT_FILE = "stamp-data.json";

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const REQUEST_DELAY = Number(process.env.REQUEST_DELAY || 500);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);

const REGENERATE_ALL =
  String(process.env.REGENERATE_ALL || "false").toLowerCase() === "true";

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY가 설정되지 않았습니다.");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// ==================================================
// 공통 함수
// ==================================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


function loadStamps() {

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`${INPUT_FILE} 파일이 없습니다.`);
  }

  const data = JSON.parse(
    fs.readFileSync(INPUT_FILE, "utf8")
  );

  if (!Array.isArray(data)) {
    throw new Error(
      "stamp-data.json 형식이 올바르지 않습니다."
    );
  }

  return data;
}


function saveStamps(stamps) {

  const temp = `${INPUT_FILE}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(stamps, null, 2),
    "utf8"
  );

  fs.renameSync(temp, INPUT_FILE);
}


// ==================================================
// 제외 키워드
// ==================================================

const EXCLUDED_EXACT = new Set([
  "대한민국",
  "한국",
  "우표",
  "korea",
  "post",
  "korea post",
  "korea post office",
  "korean post",

  "원",
  "원화",
  "krw",
  "won",
  "w"
]);


function isExcludedKeyword(value) {

  const normalized =
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  if (EXCLUDED_EXACT.has(normalized)) {
    return true;
  }


  // ------------------------------------------
  // 금액
  // ------------------------------------------

  // 100원
  // 1,000원
  if (/^\d[\d,]*\s*원$/i.test(value)) {
    return true;
  }

  // ₩1000
  if (/^₩\s*[\d,]+$/i.test(value)) {
    return true;
  }

  // KRW 1000
  if (/^krw\s*[\d,]+$/i.test(value)) {
    return true;
  }

  // 1000 won
  if (/^[\d,]+\s*won$/i.test(value)) {
    return true;
  }


  // 문자열 안에 금액이 포함된 경우
  if (/\d[\d,]*\s*원/i.test(value)) {
    return true;
  }

  if (/₩\s*[\d,]+/.test(value)) {
    return true;
  }

  if (/krw\s*[\d,]+/i.test(value)) {
    return true;
  }

  return false;
}


function cleanKeywords(keywords) {

  if (!Array.isArray(keywords)) {
    return [];
  }

  const result = [];

  for (const keyword of keywords) {

    if (typeof keyword !== "string") {
      continue;
    }

    const value =
      keyword
        .trim()
        .replace(/^["'#]+|["']+$/g, "");

    if (!value) {
      continue;
    }

    if (isExcludedKeyword(value)) {
      continue;
    }

    if (!result.includes(value)) {
      result.push(value);
    }

    if (result.length >= 10) {
      break;
    }
  }

  return result;
}


// ==================================================
// AI 응답 파싱
// ==================================================

function parseKeywordResponse(text) {

  let value =
    String(text || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();


  try {

    const parsed =
      JSON.parse(value);

    if (Array.isArray(parsed)) {
      return cleanKeywords(parsed);
    }

    if (
      parsed &&
      Array.isArray(parsed.keywords)
    ) {
      return cleanKeywords(
        parsed.keywords
      );
    }

  } catch (_) {
  }


  // JSON 배열 추출
  const match =
    value.match(/\[[\s\S]*\]/);

  if (match) {

    try {

      return cleanKeywords(
        JSON.parse(match[0])
      );

    } catch (_) {
    }
  }


  // 마지막 fallback
  return cleanKeywords(
    value.split(",")
  );
}


// ==================================================
// Prompt
// ==================================================

function buildPrompt(stamp) {

  const existingKeywords =
    Array.isArray(stamp.keywords)
      ? stamp.keywords
      : [];


  return `
당신은 우표 이미지 분석 전문 AI입니다.

우표 이미지를 직접 보고,
이미지에서 실제로 확인할 수 있는
시각적 요소를 중심으로
검색용 키워드를 최대 10개 생성하세요.


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


[기존 키워드]

이 우표에는 이전 분석에서 다음 키워드가 생성되어 있습니다.

${JSON.stringify(
  existingKeywords,
  null,
  2
)}

기존 키워드를 반드시 참고하세요.

하지만 기존 키워드가 정확하다고
가정하지 마세요.

우표 이미지를 다시 분석하여:

- 이미지와 일치하는 기존 키워드는 유지
- 이미지와 맞지 않는 기존 키워드는 제거
- 더 정확한 표현이 있으면 교체
- 이미지에서 새롭게 확인되는 중요한 요소는 추가
- 필요한 상위 카테고리를 추가
- 대표 색상을 추가

하여 최종 키워드를 다시 구성하세요.


[이미지에서 분석할 요소]

인물
동물
식물
음식
건축물
문화재
캐릭터
스포츠
운동
차량
물건
자연
장소
국가
국기
행사
상징
종교
예술
로고
문자
기타 주요 시각 요소


[상위 카테고리]

구체적인 대상과
검색에 도움이 되는 상위 개념을
함께 포함하세요.

예:

태극기
→ 국기
→ 국가

야구선수 / 야구공
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

꽃
→ 꽃
→ 식물

고양이
→ 고양이
→ 동물

이미지와 관련 없는 카테고리는
억지로 추가하지 마세요.


[색상]

이미지에서 눈에 띄는
대표 색상을 분석하세요.

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

이미지 전체에서 눈에 띄는
주요 색상만 선택하세요.

아주 작은 부분에만 존재하는
색상은 제외하세요.

색상은 최대 3개까지만 포함하세요.


[반드시 제외]

다음 단어는 절대로
최종 키워드에 포함하지 마세요.

대한민국
한국
우표
KOREA
POST
KOREA POST
Korea Post
Korea Post Office
Korean Post

원
원화
KRW
won
W

모든 액면가 표현

예:

100원
430원
1,000원
₩1000
KRW 1000

모두 제외하세요.

이미지에 KOREA POST가
보이더라도 해당 단어를
키워드로 만들지 마세요.


단, 연도나 기념주년은
금액이 아니므로 필요하면 사용할 수 있습니다.

예:

1976년
50주년

허용


[키워드 규칙]

1. 최대 10개입니다.

2. 중요한 키워드부터 작성하세요.

3. 구체적인 대상과 필요한
   상위 카테고리를 포함하세요.

4. 이미지에서 실제 확인되는
   내용을 우선하세요.

5. 기존 키워드와
   새롭게 분석한 내용을 종합하세요.

6. 기존 키워드가 틀렸다면 제거하세요.

7. 이미지에서 확인되지 않는
   내용을 추측하지 마세요.

8. 색상은 최대 3개입니다.

9. 같은 의미의 단어를
   반복하지 마세요.

10. 모든 우표에 공통적으로
    적용되는 의미 없는 단어는 제외하세요.

11. 금액과 액면가 표현은 제외하세요.

12. 대한민국, 한국, KOREA,
    POST 관련 공통 표기는 제외하세요.


[예시]

태극기가 보이는 경우:

[
  "태극기",
  "국기",
  "국가",
  "빨강",
  "파랑",
  "흰색"
]


야구선수와 야구공이 보이는 경우:

[
  "야구선수",
  "야구",
  "스포츠",
  "야구공",
  "운동",
  "빨강",
  "파랑"
]


부처님과 사찰이 보이는 경우:

[
  "부처님",
  "불교",
  "사찰",
  "종교",
  "문화유산",
  "금색",
  "갈색"
]


로보트태권V 캐릭터가 보이는 경우:

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
`;
}


// ==================================================
// OpenAI Vision
// ==================================================

async function generateKeywords(stamp) {

  if (!stamp.image) {
    throw new Error(
      "이미지 URL이 없습니다."
    );
  }


  const prompt =
    buildPrompt(stamp);


  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    try {

      const response =
        await client.responses.create({

          model: MODEL,

          input: [

            {
              role: "user",

              content: [

                {
                  type: "input_text",
                  text: prompt
                },

                {
                  type: "input_image",
                  image_url: stamp.image
                }

              ]
            }

          ]

        });


      const keywords =
        parseKeywordResponse(
          response.output_text || ""
        );


      if (!keywords.length) {

        throw new Error(
          "AI가 유효한 키워드를 생성하지 않았습니다."
        );
      }


      return keywords;

    } catch (error) {

      console.error(
        `OpenAI 실패: ${stamp.id} / ${stamp.title}`
      );

      console.error(
        error.message
      );


      if (
        attempt >= MAX_RETRIES
      ) {
        throw error;
      }


      const wait =
        3000 * (attempt + 1);


      console.log(
        `${wait / 1000}초 후 재시도...`
      );


      await sleep(wait);
    }
  }


  return [];
}


// ==================================================
// 동시 처리
// ==================================================

async function processBatch(
  stamps,
  startIndex
) {

  const batch =
    stamps.slice(
      startIndex,
      startIndex + BATCH_SIZE
    );


  const results =
    new Array(batch.length);


  let nextIndex = 0;


  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    `배치 ${
      startIndex + 1
    } ~ ${
      startIndex + batch.length
    }`
  );

  console.log(
    `동시 처리: 최대 ${CONCURRENCY}개`
  );

  console.log(
    "========================================"
  );


  async function worker() {

    while (true) {

      const localIndex =
        nextIndex++;


      if (
        localIndex >= batch.length
      ) {
        return;
      }


      const stamp =
        batch[localIndex];


      const globalIndex =
        startIndex +
        localIndex +
        1;


      console.log(
        `[${globalIndex}] 분석 시작: ${stamp.id} / ${stamp.title}`
      );


      try {

        stamp.keywords =
          await generateKeywords(
            stamp
          );


        results[localIndex] = {
          success: true,
          stamp
        };


        console.log(
          `[${globalIndex}] ✓ ${
            stamp.keywords.join(", ")
          }`
        );


      } catch (error) {

        // 실패한 우표는
        // 다음 실행에서 다시 처리
        stamp.keywords = [];


        results[localIndex] = {
          success: false,
          stamp,
          error
        };


        console.error(
          `[${globalIndex}] ❌ 실패: ${stamp.id} / ${stamp.title}`
        );
      }


      if (
        REQUEST_DELAY > 0
      ) {

        await sleep(
          REQUEST_DELAY
        );
      }
    }
  }


  const workerCount =
    Math.min(
      CONCURRENCY,
      batch.length
    );


  await Promise.all(

    Array.from(
      {
        length: workerCount
      },

      () => worker()
    )

  );


  return results;
}


// ==================================================
// Main
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


  console.log(
    `모델: ${MODEL}`
  );

  console.log(
    `배치 크기: ${BATCH_SIZE}`
  );

  console.log(
    `동시 처리: ${CONCURRENCY}`
  );

  console.log(
    `요청 대기: ${REQUEST_DELAY}ms`
  );

  console.log(
    `최대 재시도: ${MAX_RETRIES}`
  );

  console.log(
    `전체 재분석: ${REGENERATE_ALL}`
  );


  const stamps =
    loadStamps();


  const targets =
    REGENERATE_ALL

      ? stamps

      : stamps.filter(
          stamp =>
            !Array.isArray(
              stamp.keywords
            ) ||
            stamp.keywords.length === 0
        );


  console.log(
    `전체 우표: ${stamps.length}개`
  );

  console.log(
    `처리 대상: ${targets.length}개`
  );

  console.log(
    `건너뜀: ${
      stamps.length -
      targets.length
    }개`
  );


  if (!targets.length) {

    console.log(
      "처리할 우표가 없습니다."
    );

    return;
  }


  let completed = 0;
  let failed = 0;


  for (
    let start = 0;

    start < targets.length;

    start += BATCH_SIZE
  ) {


    const results =
      await processBatch(
        targets,
        start
      );


    for (
      const result of results
    ) {

      if (
        result.success
      ) {
        completed++;
      } else {
        failed++;
      }
    }


    // 배치마다 저장
    saveStamps(
      stamps
    );


    console.log("");

    console.log(
      `진행: ${
        Math.min(
          start + BATCH_SIZE,
          targets.length
        )
      }/${targets.length}`
    );

    console.log(
      `성공: ${completed}`
    );

    console.log(
      `실패: ${failed}`
    );

    console.log(
      `남음: ${
        Math.max(
          targets.length -
          (start + BATCH_SIZE),
          0
        )
      }`
    );
  }


  // 최종 저장
  saveStamps(
    stamps
  );


  console.log("");

  console.log(
    "========================================"
  );

  console.log(
    "✓ 키워드 생성 완료"
  );

  console.log(
    `전체: ${stamps.length}`
  );

  console.log(
    `이번 실행 성공: ${completed}`
  );

  console.log(
    `이번 실행 실패: ${failed}`
  );

  console.log(
    "========================================"
  );


  if (failed > 0) {

    console.log(
      "실패한 우표는 keywords=[] 상태로 남았습니다."
    );

    console.log(
      "다음 실행에서 자동으로 다시 처리됩니다."
    );
  }
}


main().catch(error => {

  console.error("");

  console.error(
    "❌ 키워드 생성 실패"
  );

  console.error(
    error
  );

  process.exit(1);
});