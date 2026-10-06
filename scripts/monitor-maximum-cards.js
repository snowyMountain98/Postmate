const fs = require("fs");
const { JSDOM } = require("jsdom");

const LIST_URL = "https://service.epost.go.kr/stamp.RetrievePostagGoodsList.postal?svctype=9&targetRow=1&timediv=2000";
const LIST_SCOPE = {
    svctype: "9",
    timediv: "2000"
};
const OUTPUT_FILE = "maximum-card-status.json";
const MAX_PAGES = Number(process.env.MAX_PAGES || 50);
const REQUEST_DELAY = Number(process.env.REQUEST_DELAY || 700);
const EXCLUDED_STATUS = new Set(["판매예정", "판매완료"]);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(`우체국 페이지 HTTP ${response.status}`);
    }

    return response.text();
}

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value) {
    if (!value) return "";

    try {
        return new URL(value, LIST_URL).href;
    } catch {
        return "";
    }
}

function extractStatus(container) {
    const image = container.querySelectorAll("img[alt]");

    for (const img of image) {
        const alt = cleanText(img.getAttribute("alt"));

        if (alt.includes("판매예정")) return "판매예정";
        if (alt.includes("판매완료")) return "판매완료";
        if (alt.includes("판매중")) return "판매중";
    }

    const text = cleanText(container.textContent);

    if (text.includes("판매예정")) return "판매예정";
    if (text.includes("판매완료")) return "판매완료";
    if (text.includes("판매중")) return "판매중";

    return "";
}

function extractCard(container) {
    const text = cleanText(container.textContent);

    const noMatch = text.match(/No\.\s*([A-Z]?\d{4,})/i);
    const priceMatch = text.match(/([\d,]+)\s*원/);
    const dateMatch = text.match(/발행일\s*:\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/);

    const titleElement = Array.from(container.querySelectorAll("a, h3, h4, strong, b, p"))
        .find(element => cleanText(element.textContent).includes("[맥시멈카드]"));

    const title = titleElement
        ? cleanText(titleElement.textContent).replace(/^\s*/, "")
        : "[맥시멈카드]";

    const linkElement = titleElement?.closest("a") || container.querySelector("a[href]");
    const imageElement = container.querySelector("img");

    let status = extractStatus(container);

    // 판매예정/판매완료 배지가 없으면 현재 판매 가능한 상태로 간주합니다.
    if (!status) {
        status = "판매중";
    }

    if (!noMatch && !priceMatch && !titleElement) {
        return null;
    }

    return {
        id: noMatch ? noMatch[1] : "",
        title,
        price: priceMatch ? priceMatch[1] : "",
        issueDate: dateMatch ? dateMatch[1].replace(/\.\s*/g, ".") : "",
        status,
        url: linkElement ? absoluteUrl(linkElement.getAttribute("href")) : "",
        image: imageElement ? absoluteUrl(imageElement.getAttribute("src")) : ""
    };
}

function parseMaximumCards(html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const candidates = [];

    // 초일봉투 탭에서 상품 이미지의 alt가 "[맥시멈카드] ..."인 상품만 선택합니다.
    const maximumImages = document.querySelectorAll('img[alt*="[맥시멈카드]"]');

    for (const image of maximumImages) {
        const title = cleanText(image.getAttribute("alt"));

        let container = image;

        // 가장 작은 "상품 1개" 블록을 찾습니다.
        // 블록 안에는 맥시멈카드 이미지 1개와 상품번호(No.) 1개만 있어야 합니다.
        for (let depth = 0; depth < 14 && container; depth++, container = container.parentElement) {
            const text = cleanText(container.textContent);

            const productImages = container.querySelectorAll(
                'img[alt*="[맥시멈카드]"], img[alt*="[묶음판매]"], img[alt*="[초일봉투]"]'
            );

            const noMatches = text.match(/No\.\s*[A-Z]?\d{4,}/ig) || [];
            const maximumImagesInContainer =
                container.querySelectorAll('img[alt*="[맥시멈카드]"]').length;

            if (
                maximumImagesInContainer !== 1 ||
                productImages.length !== 1 ||
                noMatches.length !== 1
            ) {
                continue;
            }

            const noMatch = text.match(/No\.\s*([A-Z]?\d{4,})/i);
            const priceMatches = text.match(/([\d,]+)\s*원/g) || [];
            const dateMatch = text.match(
                /발행일\s*:\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/
            );

            // 판매 상태 이미지는 상품 블록 안에 있거나 바로 상위 블록에 있을 수 있습니다.
            // 현재 우체국 HTML 구조에서는 상품별 상태 이미지가 상품 정보와 함께 반복됩니다.
            let status = "";

            const statusImage = container.querySelector(
                'img[alt*="판매예정"], img[alt*="판매완료"], img[alt*="판매중"]'
            );

            if (statusImage) {
                const alt = cleanText(statusImage.getAttribute("alt"));

                if (alt.includes("판매예정")) {
                    status = "판매예정";
                } else if (alt.includes("판매완료")) {
                    status = "판매완료";
                } else if (alt.includes("판매중")) {
                    status = "판매중";
                }
            }

            // 판매 상태 이미지가 없는 맥시멈카드는 현재 구매 가능한 상태로 간주합니다.
            if (!status) {
                status = "판매중";
            }

            const linkElement = image.closest("a");

            candidates.push({
                id: noMatch ? noMatch[1] : "",
                title,
                price: priceMatches.length > 0
                    ? cleanText(priceMatches[priceMatches.length - 1])
                        .replace(/\s*원$/, "")
                    : "",
                issueDate: dateMatch
                    ? dateMatch[1].replace(/\.\s*/g, ".")
                    : "",
                status,
                url: linkElement
                    ? absoluteUrl(linkElement.getAttribute("href"))
                    : "",
                image: absoluteUrl(image.getAttribute("src") || "")
            });

            break;
        }
    }

    const unique = new Map();

    for (const card of candidates) {
        const key = card.id || card.url || card.title;

        if (!unique.has(key)) {
            unique.set(key, card);
        }
    }

    return Array.from(unique.values());
}

function loadPrevious() {
    if (!fs.existsSync(OUTPUT_FILE)) {
        return {
            initialized: false,
            items: [],
            alerts: []
        };
    }

    try {
        const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));

        return {
            initialized: Boolean(data.initialized),
            items: Array.isArray(data.items) ? data.items : [],
            alerts: Array.isArray(data.alerts) ? data.alerts : [],
            sourceUrl: data.sourceUrl || ""
        };
    } catch {
        return {
            initialized: false,
            items: [],
            alerts: []
        };
    }
}

function compare(previous, current) {
    const previousByKey = new Map();

    for (const item of previous.items) {
        previousByKey.set(item.id || item.url || item.title, item);
    }

    const history = [...previous.alerts];
    const newAlerts = [];

    for (const currentItem of current) {
        const key = currentItem.id || currentItem.url || currentItem.title;
        const oldItem = previousByKey.get(key);

        if (!oldItem) {
            continue;
        }

        const wasUnavailable = EXCLUDED_STATUS.has(oldItem.status);
        const isNowAvailable =
            currentItem.status &&
            !EXCLUDED_STATUS.has(currentItem.status);

        if (wasUnavailable && isNowAvailable) {
            newAlerts.push({
                id: `${key}-${Date.now()}-${newAlerts.length}`,
                itemKey: key,
                title: currentItem.title,
                previousStatus: oldItem.status,
                currentStatus: currentItem.status,
                url: currentItem.url || LIST_URL,
                detectedAt: new Date().toISOString()
            });
        }
    }

    return {
        alerts: [...history, ...newAlerts].slice(-30),
        newAlerts
    };
}

function extractPaginationUrls(html, currentUrl) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const urls = new Set();

    const baseUrl = new URL(LIST_URL);

    for (const link of document.querySelectorAll("a[href]")) {
        const href = String(link.getAttribute("href") || "").trim();

        if (!href) {
            continue;
        }

        try {
            const url = new URL(href, currentUrl);

            const isSameList =
                url.hostname === baseUrl.hostname &&
                url.pathname === baseUrl.pathname;

            const targetRow = url.searchParams.get("targetRow");

            if (!isSameList || !/^\d+$/.test(targetRow || "")) {
                continue;
            }

            // 우체국 페이지네이션 링크는 svctype/timediv를 href에 포함하지 않는 경우가 있습니다.
            // 현재 감시 범위(초일봉투)를 잃지 않도록 강제로 유지합니다.
            url.searchParams.set("svctype", LIST_SCOPE.svctype);
            url.searchParams.set("timediv", LIST_SCOPE.timediv);

            urls.add(url.href);
        } catch {
            // 잘못된 링크는 무시합니다.
        }
    }

    return Array.from(urls);
}

async function collectAllPages() {
    const all = new Map();
    const visitedPages = new Set();
    const queue = [LIST_URL];

    let processedPages = 0;

    while (queue.length > 0) {
        if (MAX_PAGES > 0 && processedPages >= MAX_PAGES) {
            console.log(`MAX_PAGES=${MAX_PAGES}에 도달했습니다.\n`);
            break;
        }

        const url = queue.shift();

        if (visitedPages.has(url)) {
            continue;
        }

        visitedPages.add(url);
        processedPages++;

        console.log(`페이지 ${processedPages}: ${url}`);

        const html = await fetchHtml(url);
        const cards = parseMaximumCards(html);

        console.log(`맥시멈카드 ${cards.length}개 발견`);

        for (const card of cards) {
            const key = card.id || card.url || card.title;

            if (!all.has(key)) {
                all.set(key, card);
            }
        }

        const paginationUrls = extractPaginationUrls(html, url);

        let addedCount = 0;

        for (const pageUrl of paginationUrls) {
            if (!visitedPages.has(pageUrl) && !queue.includes(pageUrl)) {
                queue.push(pageUrl);
                addedCount++;
            }
        }

        console.log(`발견된 미방문 페이지 링크: ${addedCount}개`);
        console.log(`남은 페이지: ${queue.length}개`);

        await sleep(REQUEST_DELAY);
    }

    console.log(`전체 페이지 탐색 완료: ${processedPages}페이지`);
    console.log(`전체 맥시멈카드: ${all.size}개`);

    return Array.from(all.values());
}

async function main() {
    const previous = loadPrevious();
    const current = await collectAllPages();

    if (current.length === 0) {
        throw new Error("맥시멈카드 데이터를 찾지 못했습니다. 우체국 페이지 구조가 변경되었을 수 있습니다.");
    }

    const sameScope =
        previous.sourceUrl === LIST_URL;

    const comparison =
        previous.initialized && sameScope
            ? compare(previous, current)
            : { alerts: [], newAlerts: [] };

    const alerts = comparison.alerts;
    const newAlerts = comparison.newAlerts;

    const stateChanged =
        !previous.initialized ||
        JSON.stringify(previous.items) !== JSON.stringify(current);

    const output = {
        initialized: true,
        checkedAt: stateChanged
            ? new Date().toISOString()
            : (previous.checkedAt || new Date().toISOString()),
        sourceUrl: LIST_URL,
        excludedStatuses: Array.from(EXCLUDED_STATUS),
        items: current,
        alerts
    };

    // 실제 상품 상태가 바뀐 경우에만 저장소의 상태 파일을 갱신합니다.
    // 매 10분 실행해도 checkedAt 때문에 매번 커밋되지 않습니다.
    const nextText = JSON.stringify(output, null, 2);
    const previousText = fs.existsSync(OUTPUT_FILE)
        ? fs.readFileSync(OUTPUT_FILE, "utf8")
        : "";

    if (stateChanged || nextText !== previousText) {
        fs.writeFileSync(OUTPUT_FILE, nextText, "utf8");
        console.log(`상태 파일 갱신: ${OUTPUT_FILE}`);
    } else {
        console.log("상품 상태 변경이 없어 상태 파일을 갱신하지 않습니다.");
    }

    // 이번 실행에서 신규 알림이 발생한 경우에만 알림 파일을 만듭니다.
    // Workflow 시작 시 이전 알림 파일을 삭제하므로 과거 알림이 다시 전송되지 않습니다.
    if (newAlerts.length > 0) {
        fs.writeFileSync(
            "maximum-card-alerts.json",
            JSON.stringify(
                {
                    checkedAt: new Date().toISOString(),
                    alerts: newAlerts
                },
                null,
                2
            ),
            "utf8"
        );
    }

    for (const alert of newAlerts) {
        console.log(
            `알림 대상: ${alert.title} / ${alert.previousStatus} → ${alert.currentStatus}`
        );
    }

    if (newAlerts.length > 0) {
        console.log(`NEW_ALERT_COUNT=${newAlerts.length}`);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
