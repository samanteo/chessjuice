/**
 * FINAL check of every item the user reported:
 *   1. Mistakes tab renamed to Review
 *   2. red "due for review" button works
 *   3. review list formatting (no overflow)
 *   4. Activity heatmap: wraps, no sideways scroll, has month labels + dates
 *   5. old replay button gone; Puzzle history + Today panels present
 */
import { WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.resolve(import.meta.dirname, "..");

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch("http://localhost:9245/json/list")).json();
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
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

console.log("navigating (cache disabled)…");
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

// seed due mistakes + history (pool comes from the API — the CSV is gone)
const picked = [];
{
  const res = await fetch("http://localhost:3000/api/puzzles?themes=fork&limit=100");
  const rows = await res.json();
  for (const r of rows.slice(0, 6)) {
    picked.push({ id: r.id, rating: r.rating, themes: r.themes });
  }
}
const now = Date.now();
const progress = {}, attempts = [];
picked.forEach((p, i) => {
  progress[p.id] = { rg: 0, due: new Date(now - 60_000).toISOString(), wr: 1, at: 1, co: 0 };
  attempts.push({
    puzzleId: p.id, userId: "local", result: i % 2 ? "incorrect" : "correct",
    moveNumber: 1, timeSpent: 4000, hintUsed: false, solutionViewed: false,
    ratingBefore: 1500, ratingAfter: 1500,
    // mix: today (local) and 3 days ago
    timestamp: new Date(now - (i < 3 ? i * 3600_000 : 3 * 86400_000 + i * 3600_000)).toISOString(),
    puzzleRating: p.rating, themes: p.themes,
  });
});
await evalJs(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(progress))})`);
await evalJs(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(attempts))})`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

const errs0 = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs0.length === 0, `no uncaught exceptions on load (${errs0.length})`);

// 1. tab rename
const tabs = await evalJs(`[...document.querySelectorAll('nav button')].map(b=>b.innerText.replace(/\\n/g,' ').trim()).filter(Boolean).slice(0,5)`);
console.log(`tabs: ${JSON.stringify(tabs)}`);
ok(tabs.some((t) => /Review/.test(t)), "1. tab renamed to 'Review'");
ok(!tabs.some((t) => /Mistakes/.test(t)), "1. no 'Mistakes' tab remains");

// 2. due button
const dueBtn = await evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>/due for review/i.test(x.innerText));
  return b ? { present:true, text:b.innerText.trim() } : { present:false };
})()`);
console.log(`due button: ${JSON.stringify(dueBtn)}`);
ok(dueBtn.present, "2. red due button renders when puzzles are due");
if (dueBtn.present) {
  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/due for review/i.test(x.innerText)); b.scrollIntoView({block:'center'}); b.click(); })()`);
  await sleep(3500);
  const nav = await evalJs(`!document.querySelector('[data-testid="theme-mastery"]') && !/Quick start/i.test(document.body.innerText)`);
  ok(nav, "2. clicking it navigates to the Review tab");
}

// 3. no horizontal overflow anywhere on the page
const of = await evalJs(`(() => {
  const bad=[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+8&&e.clientWidth>60);
  return { count: bad.length, body: document.body.scrollWidth, win: window.innerWidth };
})()`);
console.log(`overflow: ${JSON.stringify(of)}`);
ok(of.body <= of.win + 1, "3. page does not scroll sideways");
ok(of.count === 0, `3. no element overflows its container (${of.count})`);

// 5. analytics: old replay gone, panels present
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(8000);
const an = await evalJs(`({
  oldReplay: !!document.querySelector('[data-testid="to-replay"]') || /\\bto replay\\b/i.test(document.body.innerText),
  panels: !!document.querySelector('[data-testid="history-panels"]'),
  all: !!document.querySelector('[data-testid="history-all-panel"]'),
  today: !!document.querySelector('[data-testid="history-today-panel"]'),
  replayAll: !!document.querySelector('[data-testid="history-all-replay"]'),
  replayToday: !!document.querySelector('[data-testid="history-today-replay"]'),
})`);
console.log(`analytics: ${JSON.stringify(an)}`);
ok(!an.oldReplay, "5. the OLD replay button is gone");
ok(an.panels && an.all && an.today, "5. Puzzle history + Today panels render");
ok(an.replayAll && an.replayToday, "5. both panels have their own Replay-all button");

// 4. heatmap: wraps, no sideways scroll, month labels + date titles
const hm = await evalJs(`(() => {
  const root = document.querySelector('[data-testid="calendar-heatmap"]');
  if (!root) return { present:false };
  const cells = [...root.querySelectorAll('[title]')];
  const cols = root.querySelector('div.flex.flex-wrap');
  const card = document.querySelector('[data-testid="activity-heatmap"]');
  const labels = [...root.querySelectorAll('div')].map(d=>d.textContent.trim()).filter(t=>/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(t));
  const wrapStyle = cols ? getComputedStyle(cols).flexWrap : null;
  return {
    present:true,
    cells: cells.length,
    titlesSample: cells.slice(0,2).map(c=>c.getAttribute('title')),
    monthLabels: [...new Set(labels)],
    flexWrap: wrapStyle,
    rootScrollW: root.scrollWidth, rootClientW: root.clientWidth,
    cardScrollW: card ? card.scrollWidth : null, cardClientW: card ? card.clientWidth : null,
    cardOverflowX: card ? getComputedStyle(card).overflowX : null,
  };
})()`);
console.log(`heatmap: ${JSON.stringify(hm, null, 1)}`);
ok(hm.present, "4. calendar heatmap renders");
ok(hm.flexWrap === "wrap", `4. week columns WRAP (flex-wrap: ${hm.flexWrap})`);
ok(hm.rootScrollW <= hm.rootClientW + 1, `4. heatmap itself does not scroll sideways (${hm.rootScrollW} <= ${hm.rootClientW})`);
ok(hm.cardOverflowX !== "auto", `4. activity card no longer has overflow-x-auto (${hm.cardOverflowX})`);
ok(hm.monthLabels.length >= 3, `4. month labels present (${hm.monthLabels.join(",")})`);
ok(/\d{4}-\d{2}-\d{2}/.test(hm.titlesSample?.[0] ?? ""), `4. cells carry date titles (${hm.titlesSample?.[0]})`);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
console.log(`\nexceptions: ${errs.length}`);
errs.slice(0,4).forEach(e=>console.log("  !", (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0,200)));
console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
