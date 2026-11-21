/**
 * Verify the DB-backed dispenser end-to-end: the browser must call /api/dispense,
 * and the served puzzle must be inside the Lichess flex band AND come from the
 * 6.19M catalogue (not the local CSV pool).
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

let id = 0;
const pending = new Map();
const events = [];
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

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

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

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

// go to All themes, click a card
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(1500);

const clicked = await evalJs(`(() => {
  const cards=[...document.querySelectorAll('button')].filter(b=>/Play →/.test(b.innerText));
  if(!cards.length) return {n:0};
  const c=cards[0]; const label=c.innerText.replace(/\\s+/g,' ').trim().slice(0,50); c.click();
  return {n:cards.length,label};
})()`);
console.log(`clicked card: ${JSON.stringify(clicked)}`);

await sleep(4000);

// did the browser actually hit /api/dispense?
const dispenseCalls = events.filter(
  (e) => e.method === "Network.requestWillBeSent" && /\/api\/dispense/.test(e.params?.request?.url ?? ""),
);
console.log(`/api/dispense requests: ${dispenseCalls.length}`);
if (dispenseCalls.length) console.log(`   url: ${dispenseCalls[0].params.request.url.slice(0, 160)}`);
ok(dispenseCalls.length > 0, "the client called /api/dispense (server catalogue in use)");

const state = await evalJs(`(() => {
  const info=document.body.innerText;
  const m=info.match(/Puzzle #(\\w+)/);
  // The head's rating pill is "1429 · you 1500" now (no "Rating" word), so read
  // the puzzle's number from its own node instead of scraping the text.
  const r=document.querySelector('[data-testid="puzzle-rating"]')?.innerText?.trim() ?? null;
  const s=JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}');
  return { puzzleId:m?m[1]:null, servedRating:r?Number(r):null, userRating:s.rating??null,
           hasBoard: !!document.querySelector('cg-board'),
           boardW: Math.round((document.querySelector('cg-board')?.getBoundingClientRect().width)||0) };
})()`);
console.log(`state: ${JSON.stringify(state)}`);

ok(state.hasBoard, "board rendered");
ok(state.boardW >= 300, `board fills phone width (${state.boardW}px)`);
if (state.userRating != null && state.servedRating != null) {
  const d = Math.abs(state.servedRating - state.userRating);
  console.log(`   target ${state.userRating}  served ${state.servedRating}  |diff| ${d}  (band ±100)`);
  ok(d <= 100, `served puzzle inside the ±100 flex band (diff ${d})`);
}

// prove it came from the 6.19M DB, not the 371k CSV pool
if (state.puzzleId) {
  const inPool = fs.readFileSync(path.join(ROOT, "public/puzzles.csv"), "utf8").includes(state.puzzleId + ",");
  console.log(`   puzzle ${state.puzzleId} present in local CSV pool: ${inPool}`);
  ok(!inPool, "served puzzle came from the SERVER catalogue (not in the local 371k pool)");
}

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
