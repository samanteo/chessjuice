/**
 * Verify 40-by-40 paging of the history LIST, and that paging never limits
 * the REPLAY QUEUE (the whole point: the list pages, the queue does not).
 */
import { WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";

const CDP = "http://localhost:9245";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.resolve(import.meta.dirname, "..");

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("no CDP page target");
}

const ws = new WebSocket(await target(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

console.log("navigating…");
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(14000);

// 95 distinct puzzles -> 3 pages of 40 / 40 / 15
const csv = fs.readFileSync(path.join(ROOT, "public/puzzles.csv"), "utf8").split("\n");
const picked = [];
for (let i = 1; i < 4000 && picked.length < 95; i++) {
  const c = csv[i].split(",");
  if (!c[0] || !c[4] || !c[4].includes("fork")) continue;
  picked.push({ id: c[0], rating: Number(c[3]), themes: c[4].split(" ") });
}
console.log(`seeding ${picked.length} fork puzzles`);
const now = Date.now();
const attempts = picked.map((p, i) => ({
  puzzleId: p.id, userId: "local", result: i % 3 === 0 ? "correct" : "incorrect",
  moveNumber: 1, timeSpent: 5000, hintUsed: false, solutionViewed: false,
  ratingBefore: 1500, ratingAfter: 1500,
  timestamp: new Date(now - i * 60_000).toISOString(),
  puzzleRating: p.rating, themes: p.themes,
}));
await evalJs(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(attempts))})`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(14000);
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(6000);

const rowsOf = () => evalJs(`document.querySelectorAll('[data-testid="history-all-panel"] li').length`);
const countOf = () => evalJs(`Number(document.querySelector('[data-testid="history-all-replay"]')?.dataset.count ?? -1)`);

const r1 = await rowsOf();
const q1 = await countOf();
console.log(`initial: rows=${r1}  queue=${q1}`);
ok(r1 === 40, `page 1 renders exactly 40 rows (${r1})`);
ok(q1 === 95, `queue already holds ALL 95 matches, not 40 (${q1})`);

const moreBtn = await evalJs(`(() => {
  const b=document.querySelector('[data-testid="history-all-more"]');
  return b ? b.innerText.trim() : null;
})()`);
console.log(`show-more button: ${JSON.stringify(moreBtn)}`);
ok(!!moreBtn, "a Show more button exists");

await evalJs(`document.querySelector('[data-testid="history-all-more"]').click()`);
await sleep(900);
const r2 = await rowsOf();
const q2 = await countOf();
console.log(`after 1 more: rows=${r2}  queue=${q2}`);
ok(r2 === 80, `page 2 renders 80 rows (${r2})`);
ok(q2 === 95, `queue still 95 — paging never limits replay (${q2})`);

await evalJs(`document.querySelector('[data-testid="history-all-more"]').click()`);
await sleep(900);
const r3 = await rowsOf();
const stillMore = await evalJs(`!!document.querySelector('[data-testid="history-all-more"]')`);
console.log(`after 2 more: rows=${r3}  more-button=${stillMore}`);
ok(r3 === 95, `final page renders all 95 rows (${r3})`);
ok(!stillMore, "Show more disappears once everything is rendered");

// changing a filter must reset paging to page 1
await evalJs(`(() => {
  const s=document.querySelector('[data-testid="history-all-result"]');
  s.value='solved'; s.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
await sleep(900);
const rAfterFilter = await rowsOf();
console.log(`after filter change: rows=${rAfterFilter}`);
ok(rAfterFilter <= 40, `filter change resets paging to page 1 (${rAfterFilter} <= 40)`);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0, 3).forEach((e) => console.log("   !", (e.params.exceptionDetails.exception?.description ?? "").slice(0, 200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
