/**
 * Regression: "Solution" must always start at MOVE 1, even when the solver got
 * a move or two right and then failed.
 *
 * The report: "in multi move puzzles if I get 1 or 2 move right then wrong after
 * it jumps to last move". The failure itself is fine — you stay on the position
 * where you failed. But tapping Solution afterwards used to leave the board at
 * that same near-the-end position while the header said "Solution — N moves".
 * Solution means "show me the line from the beginning".
 *
 * Asserts:
 *   1. failing mid-line leaves the board on the fail position (not the end)
 *   2. tapping Solution rewinds the board to the FIRST position of the line
 *   3. the counter reads "1 / N" after the rewind
 *   4. ▶ walks forward from there into the line
 */
import { WebSocket } from "ws";
import { Chess } from "chess.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/version")).json();
const ws = new WebSocket((await (await fetch("http://localhost:9245/json/list")).json()).find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 23 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1 });
};
const geo = () => ev(`(() => { const r = document.querySelector('cg-board').getBoundingClientRect(); const w = document.querySelector('cg-board').closest('.cg-wrap'); return { x: r.x, y: r.y, w: r.width, orient: (w?.className||'').includes('black') ? 'black' : 'white' }; })()`);
const xy = (g, sq) => { const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]); return { x: g.x + (g.orient === 'black' ? 7 - f : f) * g.w / 8 + g.w / 16, y: g.y + (g.orient === 'black' ? rk - 1 : 8 - rk) * g.w / 8 + g.w / 16 }; };
const snap = () => ev(`(() => {
  const s = document.querySelector('[data-testid="board-stage"]');
  const c = document.querySelector('[data-testid="move-nav-position"]');
  return { fen: s?.getAttribute('data-fen') ?? null, counter: (c?.innerText ?? '').trim() };
})()`);

// Isolated harness: never touch the user's real state.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}` });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(3500);
// Deterministic themes: this test starts a puzzle from a theme card in the pinned
// grid, so the grid must have themes. Clearing the block list makes the pins
// below seed Block 1 through the migration, instead of inheriting whatever the
// previous test in this browser profile left behind.
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(4500);

// Start a puzzle and skip until a multi-move one is served.
const started = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Play/i.test(x.innerText)); if (b) { b.click(); return true; } return false; })()`);
ok(started, "started a puzzle");
await sleep(3500);

const readId = () => ev(`(() => { const t = document.querySelector('.board-panel__title'); const m = (t?.innerText || document.body.innerText).match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
let pid = await readId();
let mv = "";
for (let i = 0; i < 10; i++) {
  const p = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid}`)).json();
  mv = (p.moves || "").trim();
  if (mv.split(" ").length >= 6) break;
  await ev(`document.querySelector('[data-testid="skip-button"]')?.click()`);
  await sleep(250);
  await ev(`document.querySelector('[data-testid="skip-button"]')?.click()`);
  await sleep(3200);
  pid = await readId();
}
const moves = mv.split(" ");
ok(moves.length >= 6, `served puzzle ${pid} has a real line (${moves.length} plies)`);

const startSnap = await snap();
const startFen = startSnap.fen;
const g = await geo();
ok(!!startFen, "board is on screen");

// Move 1 correct, then a wrong move on move 2.
const a = xy(g, moves[1].slice(0, 2)), b = xy(g, moves[1].slice(2, 4));
await click(a.x, a.y); await sleep(120); await click(b.x, b.y);
await sleep(1300);
const afterFirst = await snap();
ok(afterFirst.fen !== startFen, "the correct move registered");

const expected = moves[3];
const wrong = (() => {
  const cc = new Chess(afterFirst.fen);
  const legal = cc.moves({ verbose: true });
  return legal.find((m) => m.from + m.to !== expected.slice(0, 4)) || null;
})();
const w1 = xy(g, wrong.from), w2 = xy(g, wrong.to);
await click(w1.x, w1.y); await sleep(120); await click(w2.x, w2.y);
await sleep(1300);
const afterWrong = await snap();
console.log("afterFirst:", JSON.stringify(afterFirst));
console.log("afterWrong:", JSON.stringify(afterWrong), "| wrong move:", wrong ? wrong.from + wrong.to + " " + wrong.san : "none");
ok(afterWrong.fen === afterFirst.fen, "failing leaves the board on the position where the solver failed");
ok(afterWrong.counter !== "1 / " + afterWrong.counter.split("/")[1].trim(), "the counter is not back at move 1 yet");

// Now ask for the Solution.
await ev(`document.querySelector('[data-testid="solution-button"]')?.click()`);
await sleep(1200);
const afterSolution = await snap();
console.log("after Solution:", JSON.stringify(afterSolution));
ok(afterSolution.fen === startFen, "Solution rewinds the board to MOVE 1 (was: stayed at the fail position)");
const total = (afterSolution.counter.split("/")[1] || "").trim();
ok(afterSolution.counter.replace(/\s/g, "") === "1/" + total, `counter reads 1 / N (${afterSolution.counter})`);

// ▶ must walk forward from there. The counter speaks in SOLVER moves, so one
// ply forward is still "1 / N" — two plies must reach "2 / N".
await ev(`document.querySelector('[data-testid="move-forward"]')?.click()`);
await sleep(700);
const afterFwd = await snap();
ok(afterFwd.fen !== afterSolution.fen, "▶ walks forward into the line");
await ev(`document.querySelector('[data-testid="move-forward"]')?.click()`);
await sleep(700);
const afterFwd2 = await snap();
console.log("after 2x ▶:", JSON.stringify(afterFwd2));
ok(afterFwd2.counter.replace(/\s/g, "") === "2/" + total, `two plies forward reads 2 / N (${afterFwd2.counter})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
