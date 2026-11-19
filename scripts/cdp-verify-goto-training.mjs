/**
 * Bug 2: "Go to Training" from the Review tab must land on a PRISTINE Training
 * tab — no leftover puzzle, like a fresh load.
 *
 * The failure was: Review tab -> a mistake is on the board -> "Go to Training"
 * only switched the tab, so `selectedPuzzle` was still set and Training rendered
 * that review puzzle. It looked like Training had launched a random puzzle.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const snap = () => ev(`(() => ({
  board: !!document.querySelector('cg-board'),
  boardId: document.querySelector('.board-panel__title')?.innerText?.match(/#(\\w+)/)?.[1] ?? null,
  theme: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  pinEmpty: /Pin your daily themes here/.test(document.querySelector('main')?.innerText || ''),
  quickStart: !!document.querySelector('[data-testid="quickstart-button"]'),
}))()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
// Keep this test's clean-slate assumption: cross-device sync would otherwise
// re-import server state from an earlier run and break assertions like
// `attempts === 0` that have nothing to do with what is being tested.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
// Quick start walks the PINNED themes — without one it has nothing to serve, so
// the "a puzzle is on Training" step would fail for the wrong reason.
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);

// Seed two DUE mistakes so the Review tab has content.
const ids = [];
for (const th of ["fork", "pin"]) {
  const r = await (await fetch(`http://localhost:3000/api/dispense?rating=1500&difficulty=normal&theme=${th}`)).json();
  ids.push(r.puzzle);
}
const now = Date.now();
const prog = {}; ids.forEach(px => { prog[px.id] = { rg: 0, wr: 1, at: 1, co: 0, due: new Date(now - 60000).toISOString(), lr: new Date(now - 3600000).toISOString(), iw: 1 }; });
await ev(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(prog))})`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// THE BUG PATH (this is what the user hit):
//  1. Start a puzzle on TRAINING  -> selectedPuzzle set, boardContext "training"
//  2. Switch to Review            -> Review shows its EMPTY state (no review puzzle
//     selected), so the blue "Go to Training" button is on screen
//  3. Click it                    -> with the old code this only switched the tab,
//     so Training re-rendered the STILL-SET selectedPuzzle = a leftover puzzle
// My first attempt started a REVIEW puzzle instead, so the button never appeared
// and every assertion passed vacuously. Reproduce it properly.

// 1. A puzzle on Training.
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Training/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2500);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(8000);
const onTrainingBefore = await snap();
console.log("1. Training with a puzzle:", JSON.stringify(onTrainingBefore));
ok(onTrainingBefore.board, "a puzzle is on the Training board (selectedPuzzle is SET)");

// 2. Switch to Review — its empty state (and the button) should appear.
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);
const hasBtn = await ev(`!!([...document.querySelectorAll('button')].find(x => /Go to Training/i.test(x.innerText)))`);
console.log("2. 'Go to Training' button present on Review:", hasBtn);
ok(hasBtn, "the Review tab shows the 'Go to Training' button (its empty state)");

// 3. Click it and land on Training.
const clicked = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Go to Training/i.test(x.innerText));
  if (!b) return false; b.click(); return true;
})()`);
console.log("3. clicked 'Go to Training':", clicked);
await sleep(3500);

const onTraining = await snap();
console.log("   landed on Training:", JSON.stringify(onTraining));
ok(clicked, "the button was actually clicked (not a vacuous pass)");
ok(!onTraining.board, "Training shows NO puzzle (pristine, like a fresh load)");
ok(onTraining.boardId === null, "no leftover puzzle id carried over");
ok(onTraining.theme === null, "no leftover theme label");
ok(onTraining.quickStart, "Training shows its normal empty state (Quick start ready)");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
