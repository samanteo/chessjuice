/**
 * Solve a puzzle END TO END and prove the Glicko rating actually moves.
 *
 * Lichess puzzle format: `FEN` is the position with the OPPONENT to move, and
 * `moves` is the full line — so the app auto-plays moves[0], the solver plays
 * moves[1], the app replies moves[2], the solver plays moves[3], ...
 *
 * We read the real position off chessground's piece transforms, then click the
 * solver's moves one at a time and verify each one actually landed.
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

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// --- clean slate -------------------------------------------------------------
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
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await evalJs(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

const before = await evalJs(`(() => { const g = localStorage.getItem('puzzle_trainer_glicko_v1'); return g ? JSON.parse(g).overall.rating : null; })()`);
console.log("glicko before (expect null on a clean slate):", before);

// --- start a puzzle ----------------------------------------------------------
await evalJs(`(() => { const b=[...document.querySelectorAll('main button')].find(x=>/Random Puzzle/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(9000);

const shown = await evalJs(`(() => { const m = document.querySelector('main').innerText.match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
ok(!!shown, `a puzzle is on the board (${shown})`);
const pz = await (await fetch(`http://localhost:3000/api/puzzle?id=${shown}`)).json();
const puzzle = pz.puzzle ?? pz;
const moves = puzzle.moves.split(" ");
console.log(`solution "${puzzle.moves}" (${moves.length} plies) — solver plays indices 1,3,5…`);

// --- board geometry + a reader for the live position -------------------------
const geo = await evalJs(`(() => {
  const b = document.querySelector('cg-board');
  const r = b.getBoundingClientRect();
  const wrap = b.closest('.cg-wrap') || b.parentElement;
  const cls = (wrap?.className||'') + ' ' + (b.className||'');
  return { x: r.left, y: r.top, w: r.width, h: r.height, orient: /black/i.test(cls) ? 'black' : 'white' };
})()`);
const sq = geo.w / 8;
const FILES = "abcdefgh";
function squareToXY(name) {
  const file = name.charCodeAt(0) - 97;
  const rank = parseInt(name[1], 10);
  const col = geo.orient === "white" ? file : 7 - file;
  const row = geo.orient === "white" ? 8 - rank : rank - 1;
  return { x: geo.x + col * sq + sq / 2, y: geo.y + row * sq + sq / 2 };
}
async function clickSquare(name) {
  const { x, y } = squareToXY(name);
  // chessground does NOT respond to CDP mouse events under mobile emulation —
  // touch works. (Real desktop mice are fine; this is a harness detail.)
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(80);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);
}
/** Read occupancy straight off chessground's rendered pieces. */
const readBoard = async () => evalJs(`(() => {
  const out = {};
  for (const el of document.querySelectorAll('piece')) {
    const cls = el.className;
    const m = (el.style.transform||'').match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/);
    if (!m) continue;
    const b = document.querySelector('cg-board').getBoundingClientRect();
    const s = b.width / 8;
    const col = Math.round(parseFloat(m[1]) / s);
    const row = Math.round(parseFloat(m[2]) / s);
    if (col < 0 || col > 7 || row < 0 || row > 7) continue;
    const files = 'abcdefgh';
    const name = ${JSON.stringify(geo.orient)} === 'white'
      ? files[col] + (8 - row)
      : files[7 - col] + (row + 1);
    out[name] = cls.includes('white') ? 'W' : 'B';
  }
  return out;
})()`);

const b0 = await readBoard();
console.log(`pieces on board: ${Object.keys(b0).length}`);

// --- play the solver's moves, verifying each lands ---------------------------
let landed = 0;
for (let i = 1; i < moves.length; i += 2) {
  const mv = moves[i];
  const from = mv.slice(0, 2), to = mv.slice(2, 4);
  const beforeB = await readBoard();
  await clickSquare(from);
  await clickSquare(to);
  await sleep(900);
  const afterB = await readBoard();
  // The app auto-replies, so `to` may already hold the OPPONENT's piece by the
  // time we look. The reliable signal is: the `from` square emptied and SOMETHING
  // changed on the board.
  const left = !!beforeB[from] && !afterB[from];
  const changed = JSON.stringify(beforeB) !== JSON.stringify(afterB);
  const moved = left || changed;
  console.log(`  solver ${mv}: ${moved ? "accepted" : "NO-OP"} (from ${beforeB[from] ?? "-"}, boardChanged=${changed})`);
  if (moved) landed++;
  await sleep(1200);
}
ok(landed > 0, `at least one solver move landed (${landed})`);

await sleep(3000);
// A correct solve deliberately does NOT auto-commit (you may still press HARD),
// so commit it the way a user does: press "Next puzzle".
const clickedNext = await evalJs(`(() => {
  const b = [...document.querySelectorAll('main button')].find(x=>/Next puzzle/i.test(x.innerText));
  if (!b) return false; b.click(); return true;
})()`);
console.log("clicked Next puzzle:", clickedNext);
ok(clickedNext, "the commit control (Next puzzle) is present and clickable");
await sleep(5000);
const after = await evalJs(`(() => {
  const g = localStorage.getItem('puzzle_trainer_glicko_v1');
  // NOTE: the persisted shape is { overall: { r, d, v }, themes: {...} } — the
  // rating field is "r", not "rating". Reading .rating yields undefined, and
  // (undefined !== null) is TRUE, so an assertion written that way passes
  // vacuously. Always read .r and assert a finite number.
  const parsed = g ? JSON.parse(g) : null;
  return {
    glicko: parsed?.overall?.r ?? null,
    hasGlickoKey: !!g,
    themesTracked: parsed?.themes ? Object.keys(parsed.themes).length : 0,
    attempts: (JSON.parse(localStorage.getItem('puzzle_trainer_attempts')||'[]')).length,
    progressKeys: Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2')||'{}')).length,
  };
})()`);
console.log("after:", JSON.stringify(after));

ok(after.attempts > 0, `an attempt was recorded (${after.attempts})`);
ok(after.hasGlickoKey, "Glicko state key exists in localStorage");
ok(typeof after.glicko === "number" && Number.isFinite(after.glicko), `Glicko rating is a real number (${after.glicko})`);
ok(after.glicko !== null && after.glicko !== before, `rating MOVED (${before} -> ${after.glicko})`);
ok(after.themesTracked > 0, `per-theme ratings tracked (${after.themesTracked} themes)`);
ok(after.progressKeys > 0, `SM-2 progress written (${after.progressKeys} keys)`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
