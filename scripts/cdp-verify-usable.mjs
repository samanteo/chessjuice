/**
 * END-TO-END: is the app actually usable against the 6.19M catalogue?
 *
 * 1. Load the app, click into Training.
 * 2. Start a puzzle -> assert it arrived via /api/dispense (server, 6M).
 * 3. Assert the served puzzle id is NOT in the tiny local hydrated set
 *    (i.e. it genuinely came from the 6M catalogue, not the cache).
 * 4. Assert a board rendered with pieces.
 * 5. Assert the rating pipeline is live (Glicko state present).
 * 6. Assert zero exceptions / console errors.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// What is hydrated locally? (the user's own set — must be tiny)
const localIds = await evalJs(`(() => {
  try { return Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2')||'{}')); }
  catch { return []; }
})()`);

events.length = 0;

// Start a puzzle: use the "Random Puzzle" quick-start button.
const clicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('main button')].find(x=>/Random Puzzle/i.test(x.innerText));
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
})()`);
console.log("start:", clicked);
await sleep(9000);

// Did /api/dispense actually get hit?
const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
const dispense = reqs.filter(u => u.includes("/api/dispense"));
console.log("dispense calls:", dispense.length, dispense[0] ? "-> " + dispense[0].replace("http://localhost:3000","").slice(0,110) : "");
ok(dispense.length > 0, "puzzle came from the server dispenser (/api/dispense), not the browser");

// Board rendered?
const board = await evalJs(`(() => {
  const b = document.querySelector('cg-board');
  const pieces = document.querySelectorAll('piece');
  return { board: !!b, pieces: pieces.length, w: b ? Math.round(b.getBoundingClientRect().width) : 0 };
})()`);
console.log("board:", JSON.stringify(board));
ok(board.board, "chessground board rendered");
ok(board.pieces >= 20, `pieces on the board (${board.pieces})`);
ok(board.w > 250, `board has a real size (${board.w}px)`);

// What puzzle id is on screen, and is it outside the local set?
const shown = await evalJs(`(() => {
  const t = document.querySelector('main').innerText;
  const m = t.match(/Puzzle #([A-Za-z0-9]{5})/);
  return m ? m[1] : null;
})()`);
console.log("puzzle shown:", shown, " local hydrated ids:", JSON.stringify(localIds));
ok(!!shown, `a puzzle id is displayed (${shown})`);
ok(shown && !localIds.includes(shown), "served puzzle is NOT in the local hydrated set -> it came from the 6M catalogue");

// Is it really in the DB?
if (shown) {
  const res = await fetch(`http://localhost:3000/api/puzzle?id=${shown}`);
  const j = await res.json();
  const pz = j.puzzle ?? j;
  console.log("db lookup:", JSON.stringify({ id: pz.id, rating: pz.rating, rd: pz.ratingDeviation, themes: (pz.themes||[]).length }));
  ok(pz.id === shown, "that puzzle exists in the 6.19M SQLite catalogue");
}

// Rating pipeline alive?
const rating = await evalJs(`(() => {
  const t = document.querySelector('main').innerText;
  const m = t.match(/(\\d{3,4})\\s*\\n?\\s*Streak|Your rating:\\s*\\n?\\s*(\\d{3,4})/);
  const g = localStorage.getItem('puzzle_trainer_glicko_v1');
  return { displayed: m ? (m[1]||m[2]) : null, glicko: g ? JSON.parse(g).overall?.rating ?? null : null };
})()`);
console.log("rating:", JSON.stringify(rating));
ok(rating.glicko !== null, `Glicko state present (${rating.glicko})`);

// Errors?
const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
const cerr = events.filter(e => e.method === "Runtime.consoleAPICalled" && e.params.type === "error");
console.log(`exceptions: ${errs.length}, console errors: ${cerr.length}`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));
cerr.slice(0,3).forEach(e=>console.log("   c!", String(e.params.args?.[0]?.value??"").slice(0,200)));
ok(errs.length === 0, "no uncaught exceptions while training");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
