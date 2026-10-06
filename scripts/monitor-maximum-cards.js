const fs = require("fs");
const { JSDOM } = require("jsdom");

const LIST_URL = "https://service.epost.go.kr/stamp.RetrievePostagGoodsList.postal";
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

    const nodes = Array.from(document.querySelectorAll("*"))
        .filter(node => cleanText(node.textContent).includes("[맥시멈카드]"));

    for (const node of nodes) {
        let container = node;

        for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
            const text = cleanText(container.textContent);

            if (!text.includes("[맥시멈카드]") || !/No\.\s*[A-Z]?\d{4,}/i.test(text)) {
                continue;
            }

            const status = extractStatus(container);

            if (!status) {
                continue;
            }

            const card = extractCard(container);

            if (card) {
                candidates.push(card);
                break;
            }
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
            alerts: Array.isArray(data.alerts) ? data.alerts : []
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

    for (const link of document.querySelectorAll("a[href]")) {
        const href = String(link.getAttribute("href") || "").trim();

        if (!href) {
            continue;
        }

        try {
            const url = new URL(href, currentUrl);

            // 우표·엽서류 목록의 실제 페이징 링크입니다.
            // 현재 페이지에서는 pageSpec=StyleNp2&targetRow=9 같은 형태를 사용합니다.
            const isSameList =
                url.hostname === new URL(LIST_URL).hostname &&
                url.pathname === new URL(LIST_URL).pathname;

            const isPagination =
                /(?:^|[?&])pageSpec=[^&]*/i.test(url.search) &&
                /(?:^|[?&])targetRow=\d+/i.test(url.search);

            if (isSameList && isPagination) {
                url.hash = "";
                urls.add(url.href);
            }
        } catch {
            // 잘못된 href는 무시합니다.
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

    const comparison = previous.initialized
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
