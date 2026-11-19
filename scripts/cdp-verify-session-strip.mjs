/**
 * Session strip (Lichess progress chips):
 *  1. Squares appear as puzzles are served in Training.
 *  2. A result colours the square.
 *  3. Tapping an old square REPLAYS it — no rating, no progress, no new attempt.
 *  4. Quick start switching THEME RESTARTS the strip (user's spec).
 *  5. Capped at 30 rendered squares.
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

const state = () => ev(`(() => ({
  strip: !!document.querySelector('[data-testid="session-strip"]'),
  squares: document.querySelectorAll('[data-testid^="session-square-"]').length,
  counter: document.querySelector('[data-testid="session-strip"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
  results: [...document.querySelectorAll('[data-testid^="session-square-"]')].map(e=>e.getAttribute('data-result')),
  boardId: document.querySelector('.board-panel__title')?.innerText?.match(/#(\\w+)/)?.[1] ?? null,
  rating: JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').rating ?? null,
  attempts: JSON.parse(localStorage.getItem('puzzle_trainer_attempts')||'[]').length,
  progress: Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2')||'{}')).length,
}))()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin"]))`);
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1500, quickStartCount: 4 }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);
const s1 = await state();
console.log("after start:", JSON.stringify(s1));
ok(s1.strip, "the session strip renders in Training");
ok(s1.squares === 1, `one square for the first puzzle (${s1.squares})`);
ok(/1 \/ 1/.test(s1.counter ?? ""), `counter reads 1 / 1 (${s1.counter})`);

// Lose this one (show solution) then press Next -> a second puzzle is served.
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
await sleep(4000);
const s2 = await state();
console.log("after solution:", JSON.stringify(s2));
ok(s2.results[0] === "solution", `the square is coloured for the outcome (${s2.results[0]})`);
ok(s2.squares === 1, "still one square — the strip tracks puzzles, not attempts");

await ev(`document.querySelector('[data-testid="next-button"]').click()`);
await sleep(8000);
const s3 = await state();
console.log("after next:", JSON.stringify(s3));
ok(s3.squares === 2, `a second square appeared (${s3.squares})`);
ok(/2 \/ 2/.test(s3.counter ?? ""), `counter reads 2 / 2 (${s3.counter})`);

// ---- Replay an earlier square: must change NOTHING ---------------------------------
const before = await state();
await ev(`document.querySelector('[data-testid="session-square-0"]').click()`);
await sleep(7000);
const after = await state();
console.log("replay square 0:", JSON.stringify(after));
ok(after.boardId !== before.boardId, `tapping square 0 reopened the earlier puzzle (${before.boardId} -> ${after.boardId})`);
ok(after.rating === before.rating, `rating untouched (${before.rating} -> ${after.rating})`);
ok(after.attempts === before.attempts, `no new attempt recorded (${before.attempts} -> ${after.attempts})`);
ok(after.progress === before.progress, `SM-2 progress untouched (${before.progress} -> ${after.progress})`);
ok(/1 \/ 2/.test(after.counter ?? ""), `the strip shows you are on square 1 of 2 (${after.counter})`);

// ---- Quick start switching THEME must restart the strip ---------------------------
console.log("\n--- forcing the run to move to its next theme ---");
let guard = 0;
let moved = false;
while (guard++ < 12 && !moved) {
  const st = await state();
  const theme = await ev(`document.querySelector('[data-testid="active-theme"]')?.innerText ?? null`);
  if (theme === "Pin") { moved = true; break; }
  // Finish this puzzle so the run advances.
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
  await sleep(2500);
  await ev(`document.querySelector('[data-testid="next-button"]')?.click()`);
  await sleep(6500);
}
const themeNow = await ev(`document.querySelector('[data-testid="active-theme"]')?.innerText ?? null`);
const s4 = await state();
console.log("after theme switch:", themeNow, JSON.stringify(s4));
ok(themeNow === "Pin", `the run moved to the second pinned theme (${themeNow})`);
ok(s4.squares === 1, `the strip RESTARTED for the new theme (${s4.squares} square)`);
ok(/\bPin\b/.test(s4.counter ?? ""), `the strip names the new theme (${s4.counter})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,4).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
