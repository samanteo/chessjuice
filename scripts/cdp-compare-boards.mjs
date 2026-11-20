/**
 * Screenshot + measure the Training board and the Review board, so they can be
 * compared like-for-like. Saves PNGs for visual comparison and prints an exact
 * geometry table for the numeric one.
 *
 * Drives the REAL user flow — quick start a training puzzle, fail it (which is
 * what puts something in the review queue), then Review Due — rather than seeding
 * localStorage, because the store only hydrates puzzles that exist in the 6.19M DB.
 */
import { WebSocket } from "ws";
import fs from "fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch("http://localhost:9245/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

async function shot(file) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(r.result.data, "base64"));
  console.log("  saved " + file);
}

/** Everything that defines "how the board looks". */
const measure = () => ev(`(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  const btn = (re) => [...document.querySelectorAll('button')].find(b => re.test((b.innerText||'').trim()));
  const panel = document.querySelector('.board-panel');
  const board = document.querySelector('cg-board');
  const head = document.querySelector('.board-panel__head');
  const foot = document.querySelector('.board-panel__foot');
  const titles = document.querySelector('.board-panel__titles');
  const meta = document.querySelector('.board-panel__meta');
  const progress = document.querySelector('.board-panel__progress');
  const strip = document.querySelector('[data-testid="session-strip"]');
  const wrap = document.querySelector('[data-board-context]');
  return {
    context: wrap ? wrap.getAttribute('data-board-context') : null,
    scrollY: Math.round(scrollY),
    vw: innerWidth, vh: innerHeight,
    panel: r(panel), board: r(board), head: r(head), foot: r(foot),
    titles: r(titles), meta: r(meta), progress: r(progress), strip: r(strip),
 stripText: strip ? (strip.innerText || "").replace(/\s+/g, " ").trim() : null,
    solution: r(btn(/^Solution$/i)), hard: r(document.querySelector('[data-testid="hard-button"]')),
    skip: r(document.querySelector('[data-testid="skip-button"]')), next: r(document.querySelector('[data-testid="next-button"]')),
    themeLabel: (document.querySelector('[data-testid="active-theme"]')||{}).textContent || null,
    puzzleId: (document.querySelector('[data-testid="board-puzzle-id"]')||{}).textContent || null,
    moveCounter: (document.querySelector('[data-testid="move-counter"]')||{}).textContent || null,
    userRating: (document.querySelector('[data-testid="user-rating"]')||{}).textContent || null,
    nav: r(document.querySelector('[data-testid="move-nav"]')),
    chessground: !!document.querySelector('.cg-wrap'),
  };
})()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
// 664, not 844: 844 is the whole screen including Safari's address and tab bars,
// and no phone gives the page that much. Measuring at 844 is what let a board
// that was really 55% of the width be reported as "full-bleed".
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 664, deviceScaleFactor: 3, mobile: true });

// ---- reach a live Training board -------------------------------------------
await send("Page.navigate", { url: "http://localhost:3000/?s=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off');
          localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin","skewer"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?s=" + Date.now() });
await sleep(15000);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(9000);

const training = await measure();
console.log("\n=== TRAINING ===");
console.log(JSON.stringify(training, null, 1));
await ev(`window.scrollTo(0,0)`);
await sleep(600);
await shot("/tmp/board-training.png");

// ---- fail it so Review has something due -----------------------------------
await ev(`[...document.querySelectorAll('button')].find(b=>/^Solution$/i.test((b.innerText||'').trim()))?.click()`);
await sleep(4000);

// ---- reach a live Review board ---------------------------------------------
await ev(`document.querySelector('[data-testid="tab-mistakes"]')?.click()`);
await sleep(2500);
await ev(`[...document.querySelectorAll('button')].find(b=>/Review Due/i.test(b.innerText||''))?.click()`);
await sleep(10000);

const review = await measure();
console.log("\n=== REVIEW ===");
console.log(JSON.stringify(review, null, 1));
await ev(`window.scrollTo(0,0)`);
await sleep(600);
await shot("/tmp/board-review.png");

// ---- the comparison that actually matters ----------------------------------
const SAME = (a, b) => (a && b ? (Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1 ? "SAME" : "DIFF") : "?");
console.log("\n=== DIFF TABLE ===");
const rows = [
  ["board w x h", `${training.board?.w}x${training.board?.h}`, `${review.board?.w}x${review.board?.h}`, SAME(training.board, review.board)],
  ["board x / y", `${training.board?.x} / ${training.board?.y}`, `${review.board?.x} / ${review.board?.y}`,
   training.board?.x === review.board?.x ? "SAME" : "DIFF"],
  ["panel w / y", `${training.panel?.w} / ${training.panel?.y}`, `${review.panel?.w} / ${review.panel?.y}`,
   training.panel?.w === review.panel?.w ? "SAME" : "DIFF"],
  ["head h", `${training.head?.h}`, `${review.head?.h}`, training.head?.h === review.head?.h ? "SAME" : "DIFF"],
  ["titles w", `${training.titles?.w}`, `${review.titles?.w}`, training.titles?.w === review.titles?.w ? "SAME" : "DIFF"],
  ["meta y/h", `${training.meta?.y}/${training.meta?.h}`, `${review.meta?.y}/${review.meta?.h}`, training.meta?.h === review.meta?.h ? "SAME" : "DIFF"],
  ["foot y/h", `${training.foot?.y}/${training.foot?.h}`, `${review.foot?.y}/${review.foot?.h}`, training.foot?.h === review.foot?.h ? "SAME" : "DIFF"],
  ["strip present", `${!!training.strip}`, `${!!review.strip}`, (!!training.strip) === (!!review.strip) ? "SAME" : "DIFF"],
  ["progress (pips) y", `${training.progress?.y}`, `${review.progress?.y}`, training.progress?.y === review.progress?.y ? "SAME" : "DIFF"],
  ["Solution y", `${training.solution?.y}`, `${review.solution?.y}`, training.solution?.y === review.solution?.y ? "SAME" : "DIFF"],
  ["Hard y", `${training.hard?.y}`, `${review.hard?.y}`, training.hard?.y === review.hard?.y ? "SAME" : "DIFF"],
  ["Skip/Next y", `${training.skip?.y ?? training.next?.y}`, `${review.skip?.y ?? review.next?.y}`,
   (training.skip?.y ?? training.next?.y) === (review.skip?.y ?? review.next?.y) ? "SAME" : "DIFF"],
  ["move-nav y", `${training.nav?.y}`, `${review.nav?.y}`, training.nav?.y === review.nav?.y ? "SAME" : "DIFF"],
  ["theme label", `${training.themeLabel}`, `${review.themeLabel}`, "n/a"],
  ["puzzle id", `${training.puzzleId}`, `${review.puzzleId}`, "n/a"],
  ["user rating pill", `${training.userRating}`, `${review.userRating}`, training.userRating === review.userRating ? "SAME" : "DIFF"],
  ["scrollY", `${training.scrollY}`, `${review.scrollY}`, training.scrollY === review.scrollY ? "SAME" : "DIFF"],
  ["doc height", `${training.vh}`, `${review.vh}`, "n/a"],
];
const w = [22, 22, 22, 6];
console.log("  " + "what".padEnd(w[0]) + "TRAINING".padEnd(w[1]) + "REVIEW".padEnd(w[2]) + "match");
for (const [a, b, c, d] of rows) console.log("  " + String(a).padEnd(w[0]) + String(b).padEnd(w[1]) + String(c).padEnd(w[2]) + d);
ws.close(); process.exit(0);
