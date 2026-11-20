/**
 * Session strip = the previous/next PUZZLE pager under the board.
 *
 *  1. It renders as soon as a puzzle is served.
 *  2. The ◀ ▶ pair walks the batch and the label says which puzzle you are on.
 *  3. Replaying an earlier puzzle changes NOTHING (no rating, no attempt, no SM-2).
 *  4. A Quick-start theme switch RESTARTS the batch (the user's spec).
 *  5. There are NO per-puzzle SQUARES any more. They were removed on the user's
 *     request: "eventually there will be more squares than the page can handle,
 *     the left right thing will be enough."
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
  label: document.querySelector('[data-testid="session-label"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
  prevDisabled: document.querySelector('[data-testid="session-prev"]')?.disabled ?? null,
  nextDisabled: document.querySelector('[data-testid="session-next"]')?.disabled ?? null,
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
// Clean-slate assumption: sync would otherwise re-import server state from an
// earlier run and break the `attempts === 0`-style assertions below.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
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
ok(s1.squares === 0, `NO per-puzzle squares are rendered (${s1.squares}) — removed by request`);
ok(/1 \/ 1/.test(s1.label ?? ""), `label reads Puzzle 1 / 1 (${s1.label})`);
ok(s1.prevDisabled === true, "◀ is disabled on the first puzzle");
ok(s1.nextDisabled === true, "▶ is disabled when the batch has one puzzle");

// Lose this one (show the solution) then press Next -> a second puzzle is served.
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
await sleep(4000);
const s2 = await state();
console.log("after solution:", JSON.stringify(s2));
ok(/1 \/ 1/.test(s2.label ?? ""), `still one entry — the batch tracks PUZZLES, not attempts (${s2.label})`);

await ev(`document.querySelector('[data-testid="next-button"]').click()`);
await sleep(8000);
const s3 = await state();
console.log("after next:", JSON.stringify(s3));
ok(/2 \/ 2/.test(s3.label ?? ""), `a second entry appeared — Puzzle 2 / 2 (${s3.label})`);
ok(s3.prevDisabled === false, "◀ is now enabled");

// ---- Page back: must change NOTHING -----------------------------------------
const before = await state();
await ev(`document.querySelector('[data-testid="session-prev"]').click()`);
await sleep(7000);
const after = await state();
console.log("after ◀:", JSON.stringify(after));
ok(after.boardId !== before.boardId, `◀ reopened the earlier puzzle (${before.boardId} -> ${after.boardId})`);
ok(after.rating === before.rating, `rating untouched (${before.rating} -> ${after.rating})`);
ok(after.attempts === before.attempts, `no new attempt recorded (${before.attempts} -> ${after.attempts})`);
ok(after.progress === before.progress, `SM-2 progress untouched (${before.progress} -> ${after.progress})`);
ok(/1 \/ 2/.test(after.label ?? ""), `the label shows you are on puzzle 1 of 2 (${after.label})`);
ok(after.nextDisabled === false, "▶ is enabled so you can walk forward again");

// ---- Quick start switching THEME must restart the batch ----------------------
console.log("\n--- forcing the run to move to its next theme ---");
let guard = 0;
let moved = false;
while (guard++ < 12 && !moved) {
  const theme = await ev(`document.querySelector('[data-testid="active-theme"]')?.innerText ?? null`);
  if (theme === "Pin") { moved = true; break; }
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
  await sleep(2500);
  await ev(`document.querySelector('[data-testid="next-button"]')?.click()`);
  await sleep(6500);
}
const themeNow = await ev(`document.querySelector('[data-testid="active-theme"]')?.innerText ?? null`);
const s4 = await state();
console.log("after theme switch:", themeNow, JSON.stringify(s4));
ok(themeNow === "Pin", `the run moved to the second pinned theme (${themeNow})`);
ok(/1 \/ 1/.test(s4.label ?? ""), `the batch RESTARTED for the new theme (${s4.label})`);
ok(/\bPin\b/.test(s4.label ?? ""), `the label names the new theme (${s4.label})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,4).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
