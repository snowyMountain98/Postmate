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

    const status = extractStatus(container);

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

    const alerts = [...previous.alerts];

    for (const currentItem of current) {
        const key = currentItem.id || currentItem.url || currentItem.title;
        const oldItem = previousByKey.get(key);

        if (!oldItem) {
            continue;
        }

        const wasUnavailable = EXCLUDED_STATUS.has(oldItem.status);
        const isNowAvailable = currentItem.status && !EXCLUDED_STATUS.has(currentItem.status);

        if (wasUnavailable && isNowAvailable && oldItem.status !== currentItem.status) {
            alerts.push({
                id: `${key}-${Date.now()}`,
                itemKey: key,
                title: currentItem.title,
                previousStatus: oldItem.status,
                currentStatus: currentItem.status,
                url: currentItem.url || LIST_URL,
                detectedAt: new Date().toISOString()
            });
        }
    }

    return alerts.slice(-30);
}

async function collectAllPages() {
    const all = new Map();

    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = new URL(LIST_URL);

        if (page > 1) {
            url.searchParams.set("currentPage", String(page));
        }

        console.log(`페이지 ${page}: ${url.href}`);

        const html = await fetchHtml(url.href);
        const cards = parseMaximumCards(html);

        console.log(`맥시멈카드 ${cards.length}개 발견`);

        for (const card of cards) {
            const key = card.id || card.url || card.title;

            if (!all.has(key)) {
                all.set(key, card);
            }
        }

        const pageLinks = Array.from(new JSDOM(html).window.document.querySelectorAll("a[href]"))
            .map(link => link.getAttribute("href"))
            .filter(Boolean)
            .filter(href => /currentPage=\d+/i.test(href));

        const pageNumbers = pageLinks
            .map(href => {
                const match = href.match(/currentPage=(\d+)/i);
                return match ? Number(match[1]) : 0;
            })
            .filter(Boolean);

        if (!pageNumbers.some(number => number > page)) {
            break;
        }

        await sleep(REQUEST_DELAY);
    }

    return Array.from(all.values());
}

async function main() {
    const previous = loadPrevious();
    const current = await collectAllPages();

    if (current.length === 0) {
        throw new Error("맥시멈카드 데이터를 찾지 못했습니다. 우체국 페이지 구조가 변경되었을 수 있습니다.");
    }

    const alerts = previous.initialized
        ? compare(previous, current)
        : [];

    const output = {
        initialized: true,
        checkedAt: new Date().toISOString(),
        sourceUrl: LIST_URL,
        excludedStatuses: Array.from(EXCLUDED_STATUS),
        items: current,
        alerts
    };

    const nextText = JSON.stringify(output, null, 2);
    const previousText = fs.existsSync(OUTPUT_FILE)
        ? fs.readFileSync(OUTPUT_FILE, "utf8")
        : "";

    if (nextText !== previousText) {
        fs.writeFileSync(OUTPUT_FILE, nextText, "utf8");
        console.log(`상태 파일 갱신: ${OUTPUT_FILE}`);
    } else {
        console.log("변경 사항이 없어 상태 파일을 갱신하지 않습니다.");
    }

    for (const alert of alerts) {
        console.log(
            `알림 대상: ${alert.title} / ${alert.previousStatus} → ${alert.currentStatus}`
        );
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
