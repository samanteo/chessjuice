/**
 * Verify the Analytics puzzle-history panels:
 *   - the old replay button is gone
 *   - both panels render (all history + today)
 *   - all three filters exist and actually filter
 *   - "Replay all" queues the filtered set and opens the board in PRACTICE mode
 *     (i.e. a completed replay must NOT touch the SM-2 ladder or the rating)
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
// --- HARNESS ISOLATION GUARD: opt out of sync BEFORE the app boots -----------
// `Page.addScriptToEvaluateOnNewDocument` runs in the new document BEFORE any
// page script, so `puzzle_trainer_sync==='off'` is in place before
// installStateSync() runs. The app then neither PULLS from nor PUSHES to the
// user's real /api/state store. Setting the flag AFTER the first load is too
// late — the app has already booted and may already have pushed (that is how a
// fake quickStartCount/rating leaked into the user's real state).
// ONE mechanism, identical in every harness in this directory.
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}",
});
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(14000);

// ---- seed history using REAL catalogue puzzles so the join resolves ----
// (The 53 MB CSV is gone; ask the server for real fork puzzles instead.)
const seeded = [];
{
  const res = await fetch("http://localhost:3000/api/puzzles?themes=fork&limit=6");
  const rows = await res.json();
  for (const r of rows) {
    seeded.push({ id: r.id, rating: r.rating, themes: r.themes });
  }
}
console.log(`seeding ${seeded.length} fork puzzles`);

// 4 attempts inside 24h, 2 older than 24h → Today must hold exactly 4.
const now = Date.now();
const HOUR = 3600_000;
const attempts = seeded.map((p, i) => ({
  puzzleId: p.id, userId: "local", result: i % 2 === 0 ? "correct" : "incorrect",
  moveNumber: 1, timeSpent: 5000, hintUsed: false, solutionViewed: false,
  ratingBefore: 1500, ratingAfter: 1500,
  // first 4 within 24h, last 2 at 30h and 48h ago
  timestamp: new Date(now - (i < 4 ? i * HOUR : (i - 3) * 24 * HOUR)).toISOString(),
  puzzleRating: p.rating, themes: p.themes,
}));
const RECENT = attempts.filter((a) => now - new Date(a.timestamp).getTime() < 24 * HOUR).length;
console.log(`attempts within 24h: ${RECENT} of ${attempts.length}`);

await evalJs(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(attempts))})`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(14000);

await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(6000);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0, 3).forEach((e) => console.log("   !", (e.params.exceptionDetails.exception?.description ?? "").slice(0, 200)));

const panels = await evalJs(`({
  all: !!document.querySelector('[data-testid="history-all-panel"]'),
  today: !!document.querySelector('[data-testid="history-today-panel"]'),
  replayAll: !!document.querySelector('[data-testid="history-all-replay"]'),
  replayToday: !!document.querySelector('[data-testid="history-today-replay"]'),
  range: !!document.querySelector('[data-testid="history-all-range"]'),
  theme: !!document.querySelector('[data-testid="history-all-theme"]'),
  result: !!document.querySelector('[data-testid="history-all-result"]'),
  oldReplay: !!document.querySelector('[data-testid="to-replay"]'),
})`);
console.log(`panels: ${JSON.stringify(panels)}`);
ok(!panels.oldReplay, "the old replay button is GONE");
ok(panels.all && panels.today, "both history panels render (all + today)");
ok(panels.replayAll && panels.replayToday, "both replay-queue buttons exist");
ok(panels.range && panels.theme && panels.result, "all three filters present (range/theme/result)");

// Today must be a strict subset of all-history
const counts = await evalJs(`({
  all: Number(document.querySelector('[data-testid="history-all-replay"]')?.dataset.count ?? -1),
  today: Number(document.querySelector('[data-testid="history-today-replay"]')?.dataset.count ?? -1),
})`);
console.log(`queue counts: all=${counts.all}  today=${counts.today}`);
ok(counts.all >= counts.today, "Today is a subset of all history");
ok(counts.today === RECENT, `Today holds only the last-24h puzzles (${counts.today} == ${RECENT})`);

// the result filter must actually filter
const beforeFilter = await evalJs(`Number(document.querySelector('[data-testid="history-all-replay"]')?.dataset.count ?? -1)`);
await evalJs(`(() => {
  const s=document.querySelector('[data-testid="history-all-result"]');
  s.value='solved'; s.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
await sleep(800);
const afterFilter = await evalJs(`Number(document.querySelector('[data-testid="history-all-replay"]')?.dataset.count ?? -1)`);
console.log(`result filter: ${beforeFilter} -> ${afterFilter}`);
ok(afterFilter < beforeFilter, "the result filter actually filters the queue");

// ---- replay: board opens, and a completed replay must NOT change the ladder ----
// Seed a KNOWN ladder state for the puzzle that will be replayed first, so the
// comparison is meaningful (an absent key would make null === null pass trivially).
const firstId = seeded[0].id;
const seededProgress = {
  [firstId]: { rg: 3, due: new Date(Date.now() + 3 * 86400_000).toISOString(), wr: 1, at: 2, co: 1 },
};
await evalJs(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(seededProgress))})`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(14000);
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(6000);

const before = await evalJs(`localStorage.getItem('puzzle_trainer_progress_v2')`);
const beforeGlicko = await evalJs(`localStorage.getItem('puzzle_trainer_glicko_v1')`);
console.log(`seeded ladder rung for ${firstId}: ${String(before).slice(0, 110)}`);

await evalJs(`document.querySelector('[data-testid="history-all-replay"]').click()`);
await sleep(4000);

const replayState = await evalJs(`({
  board: !!document.querySelector('cg-board'),
  boardW: Math.round(document.querySelector('cg-board')?.getBoundingClientRect().width||0),
  onTraining: !!document.querySelector('[data-testid="quickstart-button"]'),
})`);
console.log(`replay state: ${JSON.stringify(replayState)}`);
ok(replayState.board, "Replay all opened the board");
ok(replayState.boardW >= 300, `board fills phone width (${replayState.boardW}px)`);

// Press Hard. In normal training this drops the puzzle to rung 0 — in practice
// mode it must leave progress byte-identical.
const pressed = await evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>/Hard/i.test(x.innerText));
  if(!b) return false; b.click(); return true;
})()`);
console.log(`pressed Hard in replay: ${pressed}`);
await sleep(3000);

const after = await evalJs(`localStorage.getItem('puzzle_trainer_progress_v2')`);
const afterGlicko = await evalJs(`localStorage.getItem('puzzle_trainer_glicko_v1')`);
console.log(`ladder after        : ${String(after).slice(0, 110)}`);
ok(pressed, "the Hard button was actually pressed during replay");
ok(after !== null && after === before, "replay did NOT touch the SM-2 ladder (rung still 3)");
ok(afterGlicko === beforeGlicko, "replay did NOT touch the Glicko rating");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
