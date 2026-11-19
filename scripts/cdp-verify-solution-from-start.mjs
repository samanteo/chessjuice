/**
 * After revealing the solution (or getting it wrong) the board must land on the
 * START of the line, so you can step FORWARD through it — instead of landing on
 * the final position and having to rewind to move 1 every time.
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

const nav = () => ev(`(() => {
  const t = document.querySelector('[data-testid="move-nav-position"]')?.innerText?.trim() ?? null;
  const fwd = document.querySelector('[data-testid="move-forward"]');
  const back = document.querySelector('[data-testid="move-back"]');
  return { counter: t, canFwd: fwd ? !fwd.disabled : null, canBack: back ? !back.disabled : null,
           live: !!document.querySelector('[data-testid="move-live"]') };
})()`);
// A fingerprint of the displayed position: the ACTUAL style of every piece, not
// just its total length (a length is a weak hash — two different positions can
// easily produce the same one, which gave a false failure here).
const sig = () => ev(`[...document.querySelectorAll('piece')].map(p=>p.getAttribute('style')||'').join('|')`);

async function boot(pinned = ["fork"]) {
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(13000);
  await ev(`localStorage.clear()`);
  await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
  await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', ${JSON.stringify(JSON.stringify(pinned))})`);
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(16000);
}

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// ---------- 1. Show solution ------------------------------------------------
await boot();
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);

// Find a multi-move puzzle so the assertion is not vacuous.
let guard = 0, counterText = null;
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
await sleep(4500);

const after = await nav();
console.log("after 'Solution':", JSON.stringify(after));
ok(after.counter !== null, `the position counter is shown (${after.counter})`);

const m = (after.counter ?? "").match(/^(\d+)\s*\/\s*(\d+)$/);
ok(!!m, `counter is "n / total" (${after.counter})`);
if (m) {
  const [cur, total] = [Number(m[1]), Number(m[2])];
  console.log(`   landed at ${cur} of ${total}`);
  ok(total > 1, `this puzzle has a multi-move line (${total} positions)`);
  ok(cur <= 1, `landed at the START of the line, not the end (${cur} of ${total})`);
}
ok(after.canFwd === true, "forward is enabled, so the line can be stepped through");
ok(after.live === true, "a 'Back to position' control is offered");

// Stepping forward must actually change the position.
const s0 = await sig();
await ev(`document.querySelector('[data-testid="move-forward"]').click()`);
await sleep(900);
const s1 = await sig();
const afterFwd = await nav();
console.log("after one ▶:", JSON.stringify(afterFwd), `sig ${s0} -> ${s1}`);
ok(s1 !== s0, "▶ advances the board through the solution");
ok(Number((afterFwd.counter ?? "0").split("/")[0]) > 0, `the counter advanced (${afterFwd.counter})`);

// ---------- 2. A LOSS must behave the same (wrong move / timeout) -----------
// A wrong move and a timeout both go through finish(false) -> playOutRemaining(),
// the same code path as "Show solution". A timeout is the deterministic way to
// trigger it: set a 3s clock and let it run out.
await boot();
await ev(`localStorage.setItem('puzzle_trainer_theme_prefs', JSON.stringify({ puzzleTimerSeconds: 3 }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(10000);   // let the 3s clock expire

const afterLoss = await nav();
const boardUp = await ev(`!!document.querySelector('cg-board')`);
const fb = await ev(`document.querySelector('.board-feedback')?.innerText ?? null`);
console.log("after clock expiry:", JSON.stringify(afterLoss), "board:", boardUp, "feedback:", JSON.stringify(fb));

ok(boardUp, "the board stays after a loss (does not exit)");
const lm = (afterLoss.counter ?? "").match(/^(\d+)\s*\/\s*(\d+)$/);
ok(!!lm, `a position counter is shown after a loss (${afterLoss.counter})`);
if (lm) {
  const [cur, total] = [Number(lm[1]), Number(lm[2])];
  ok(total > 1, `the loss played out a multi-move line (${total} positions)`);
  ok(cur <= 1, `the loss ALSO lands at the start of the line (${cur} of ${total})`);
}
ok(afterLoss.canFwd === true, "forward is enabled after a loss, so it can be stepped through");

const l0 = await sig();
await ev(`document.querySelector('[data-testid="move-forward"]').click()`);
await sleep(900);
const l1 = await sig();
ok(l1 !== l0, "▶ advances through the solution after a loss too");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
