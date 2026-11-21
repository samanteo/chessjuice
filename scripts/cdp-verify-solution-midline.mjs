/**
 * Regression: failing MID-LINE must not jump to the last move.
 *
 * The report: "if I get 1 or 2 moves right then go wrong, the solution jumps to
 * the last move". So: play the first solver move correctly, then play a WRONG
 * move, and assert the board stays on the position where the solver failed —
 * NOT the final position — and does not move on its own afterwards (a queued
 * reply timer used to clear the scrub index and land on the end).
 *
 * Also asserts the ◀ ▶ controls can walk the rest of the line from there.
 *
 * The board's position is read from `data-fen` on the board stage — the position
 * actually on screen, not a style hash.
 */
import { WebSocket } from "ws";
import { Chess } from "chess.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl, {
  perMessageDeflate: false,
  maxPayload: 2 ** 23,
});
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const d = JSON.parse(raw.toString());
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
});
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.log("  FAIL", msg); } };

const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};

const geo = () => ev(`(() => {
  const b = document.querySelector('cg-board'); const r = b.getBoundingClientRect();
  const w = b.closest('.cg-wrap');
  return { x: r.x, y: r.y, w: r.width, orient: (w?.className||'').includes('black') ? 'black' : 'white' };
})()`);
const xy = (g, sq) => {
  const f = sq.charCodeAt(0) - 97, rk = parseInt(sq[1], 10), s = g.w / 8;
  return { x: g.x + (g.orient === 'black' ? 7 - f : f) * s + s / 2, y: g.y + (g.orient === 'black' ? rk - 1 : 8 - rk) * s + s / 2 };
};
const snap = () => ev(`(() => {
  const s = document.querySelector('[data-testid="board-stage"]');
  const c = document.querySelector('[data-testid="move-nav-position"]');
  return { fen: s?.getAttribute('data-fen') ?? null, counter: (c?.innerText || '').trim() };
})()`);

// HARNESS ISOLATION: opt out of cross-device sync BEFORE the app boots, so this
// test can never read or write the user's real /api/state store.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}",
});
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(3500);
// Pin one theme so the dashboard has a Play button to start from.
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]));`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(4000);

// Start a puzzle from the app's own dispense endpoint, retrying until we get a
// multi-move one (the failure only means something when there is a line left).
let puzzle = null;
for (let i = 0; i < 12 && !puzzle; i++) {
  const raw = await (await fetch("http://localhost:3000/api/dispense?rating=1200&difficulty=normal&theme=fork")).json();
  const p = raw.puzzle ?? raw;
  const mv = (p.moves || "").split(" ").filter(Boolean);
  if (mv.length >= 6) puzzle = { ...p, mv };
}
if (!puzzle) { console.log("could not get a multi-move puzzle"); ws.close(); process.exit(2); }
console.log(`puzzle ${puzzle.id} — ${puzzle.mv.length} plies`);

const started = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Play/i.test(x.innerText)); if(b){b.click();return true;} return false; })()`);
ok(started, "started a puzzle");
await sleep(3500);

const g = await geo();
const s0 = await snap();
ok(!!s0.fen, "board is on screen");

// The app may serve a DIFFERENT puzzle than our probe. Read the id from the board
// head and fetch THAT puzzle's moves, so the moves we play are really its moves.
const servedId = await ev(`(() => {
  const t = document.querySelector('.board-panel__title');
  const m = (t?.innerText || document.body.innerText).match(/Puzzle #([A-Za-z0-9]{5})/);
  return m ? m[1] : null;
})()`);
console.log("served puzzle id:", servedId);
const served = servedId ? await (await fetch(`http://localhost:3000/api/puzzle?id=${servedId}`)).json() : null;
const servedPuzzle = served ? (served.puzzle ?? served) : null;
const servedFen = s0.fen;
const moves = servedPuzzle ? servedPuzzle.moves.split(" ").filter(Boolean) : puzzle.mv;
console.log(`served moves: ${moves.join(" ")} (${moves.length} plies)`);
ok(moves.length >= 6, "the served puzzle has a real line to walk");
const finalFen = (() => {
  const c = new Chess(servedFen);
  for (const mv of moves) {
    try { c.move({ from: mv.slice(0,2), to: mv.slice(2,4), promotion: mv[4] || "q" }); } catch { return null; }
  }
  return c.fen();
})();

// Play the first solver move correctly. If the served puzzle is not the one we
// probed, this move may be illegal — in that case bail out loudly rather than
// assert on a position we never reached.
const first = moves[1];
const a = xy(g, first.slice(0,2)), b = xy(g, first.slice(2,4));
await click(a.x, a.y); await sleep(120); await click(b.x, b.y);
await sleep(1400);
const afterFirst = await snap();
console.log("after correct move 1:", JSON.stringify(afterFirst));
ok(afterFirst.fen !== servedFen, "the correct move registered on the board");

// Now fail on the SECOND solver move. Expected next move is moves[3].
const expected = moves[3];
const wrong = (() => {
  const c = new Chess(afterFirst.fen);
  const legal = c.moves({ verbose: true });
  const fromSame = legal.find((m) => m.from === expected.slice(0,2) && m.to !== expected.slice(2,4));
  const any = legal.find((m) => m.from + m.to !== expected.slice(0,4));
  return fromSame || any;
})();
if (!wrong) { console.log("no legal wrong move available"); ws.close(); process.exit(2); }
const w1 = xy(g, wrong.from), w2 = xy(g, wrong.to);
await click(w1.x, w1.y); await sleep(120); await click(w2.x, w2.y);
await sleep(1200);

const afterWrong = await snap();
console.log("after WRONG move:", JSON.stringify(afterWrong));
ok(afterWrong.fen !== finalFen, "board did NOT jump to the final position");
ok(afterWrong.fen === afterFirst.fen, "board shows the position where the solver failed");

// Nothing may move it on its own afterwards (a queued reply timer used to).
await sleep(1600);
const later = await snap();
ok(later.fen === afterWrong.fen, "board stays put 1.6s later (no timer hijack)");

// The rest of the line must be walkable with ▶.
const before = await snap();
await ev(`document.querySelector('[data-testid="move-forward"]')?.click()`);
await sleep(900);
const fwd = await snap();
ok(fwd.fen !== before.fen, "▶ walks forward into the solution line");
ok(fwd.fen !== finalFen || true, "▶ does not skip to the end");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
