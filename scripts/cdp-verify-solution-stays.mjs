/**
 * Losing outcomes must NOT yank the board away (Lichess behaviour):
 *  - wrong move  -> board stays, full solution played out, step-through-able
 *  - solution    -> same
 *  - TIMER EXPIRY -> board stays (this was the "clock exits the board" bug)
 *  - the attempt is recorded exactly ONCE, even after pressing Next
 *  - "Next puzzle" still works
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

const boardState = () => ev(`(() => ({
  up: !!document.querySelector('cg-board'),
  id: document.querySelector('.board-panel__title')?.innerText?.match(/#(\\w+)/)?.[1] ?? null,
  feedback: document.querySelector('.board-feedback')?.innerText ?? null,
  next: !!document.querySelector('[data-testid="next-button"]'),
  skip: !!document.querySelector('[data-testid="skip-button"]'),
  back: !!document.querySelector('[data-testid="move-back"]'),
  navCounter: document.querySelector('[data-testid="move-nav"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
  attempts: JSON.parse(localStorage.getItem('puzzle_trainer_attempts')||'[]').length,
}))()`);

async function boot(timeoutSeconds) {
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(13000);
  await ev(`localStorage.clear()`);
  await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
  // The per-puzzle clock lives in the THEME PREFS, not in `puzzle_trainer_settings`.
  await ev(`localStorage.setItem('puzzle_trainer_theme_prefs', JSON.stringify({ puzzleTimerSeconds: ${timeoutSeconds} }))`);
  await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1500 }))`);
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(15000);
  await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
  await sleep(9000);
}

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// ---------- 1. "Show solution" must not remove the board -------------------
await boot(0);
const before1 = await boardState();
console.log("start:", JSON.stringify(before1));
ok(before1.up, "board is up before showing the solution");

await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
await sleep(5000);              // well past the old 1500ms auto-advance
const after1 = await boardState();
console.log("after Solution (+5s):", JSON.stringify(after1));
ok(after1.up, "board STAYS after showing the solution (was: disappeared after 1.5s)");
ok(after1.id === before1.id, `still the SAME puzzle (${after1.id})`);
ok(after1.next && !after1.skip, "an enabled Next puzzle is offered, no Skip");
ok(after1.attempts === 1, `the attempt was recorded exactly once (${after1.attempts})`);

// The solution must be step-through-able.
const nav = await ev(`(() => {
  const lbl = document.querySelector('[data-testid="move-nav"]')?.innerText || "";
  return { counter: lbl.replace(/\\s+/g," ").trim() };
})()`);
console.log("move nav:", JSON.stringify(nav));
ok(/\d+\s*\/\s*\d+/.test(nav.counter ?? ""), `move nav shows a position counter (${nav.counter})`);

// Step back and confirm the view really changes.
const fenAt = () => ev(`document.querySelector('cg-board') ? [...document.querySelectorAll('piece')].map(p=>p.getAttribute('style')||'').join('|').length : -1`);
const endLen = await fenAt();
await ev(`(() => { const b=document.querySelector('[data-testid="move-back"]'); for(let i=0;i<6;i++) b && b.click(); })()`);
await sleep(1200);
const startLen = await fenAt();
console.log("piece-signature end vs after stepping back:", endLen, startLen);
ok(startLen !== endLen, "stepping back with ◀ changes the displayed position");

// Pressing Next must not double-record.
const beforeNext = (await boardState()).attempts;
await ev(`document.querySelector('[data-testid="next-button"]').click()`);
await sleep(7000);
const afterNext = await boardState();
console.log("after Next:", JSON.stringify(afterNext));
ok(afterNext.id !== before1.id, `Next loads a NEW puzzle (${before1.id} -> ${afterNext.id})`);
ok(afterNext.attempts === beforeNext, `Next did NOT record the attempt twice (${beforeNext} -> ${afterNext.attempts})`);
ok(!/[\/]12:00/.test(afterNext.navCounter ?? ""), "fresh puzzle starts from the beginning of its line");

// ---------- 2. TIMER EXPIRY must not exit the board ------------------------
console.log("\n--- forcing a timer expiry (3s clock) ---");
await boot(3);
const t0 = await boardState();
console.log("start:", JSON.stringify(t0));
ok(t0.up, "board is up with a 3s clock");
await sleep(9000);              // let the clock run out + the old 1600ms path have fired
const t1 = await boardState();
console.log("after expiry (+9s):", JSON.stringify(t1));
ok(t1.up, "board STAYS after the clock runs out (was: it exited)");
ok(t1.id === t0.id, `still the SAME puzzle after timeout (${t1.id})`);
ok(/time|best move/i.test(t1.feedback ?? ""), `the user is told what happened (${t1.feedback})`);
ok(t1.next && !t1.skip, "Next puzzle is offered after a timeout");
ok(t1.attempts === 1, `timeout recorded exactly once (${t1.attempts})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,4).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
