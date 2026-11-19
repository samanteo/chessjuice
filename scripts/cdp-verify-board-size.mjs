/**
 * Verify the board is the HERO of the layout at both phone and desktop sizes.
 *
 *   Phone (390x844): the cg-board must be essentially FULL-BLEED — width >= 95%
 *   of the viewport width, and square-ish (w/h within 3%).
 *
 *   Desktop (1408x881): the cg-board must be a large centred square whose HEIGHT
 *   is 65%..80% of the viewport height, AND the Solution / Next/Skip / Hard
 *   buttons must still be fully inside the viewport (bottom <= innerHeight) so
 *   nothing is pushed off-screen.
 *
 * Harness copied from scripts/cdp-verify-session-strip.mjs: connects to the
 * already-running headless Brave over CDP, uses Emulation.setDeviceMetricsOverride
 * for the viewport and Runtime.evaluate to measure. Chessground clicks use
 * Input.dispatchTouchEvent under mobile emulation (mouse events are ignored).
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

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

/** Measure everything the assertions care about, in one round-trip. */
const measure = () => ev(`(() => {
  const board = document.querySelector('cg-board');
  const br = board ? board.getBoundingClientRect() : null;
  const stage = document.querySelector('[data-testid="board-stage"]');
  const panel = document.querySelector('.board-panel');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const byText = (re) => [...document.querySelectorAll('button')].find(x => re.test(x.innerText.trim()));
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    board: br ? { w: Math.round(br.width), h: Math.round(br.height), top: Math.round(br.top), bottom: Math.round(br.bottom) } : null,
    wrapper: r(document.querySelector('[data-board-context]')),
    panel: r(panel),
    stage: r(stage),
    foot: r(document.querySelector('.board-panel__foot')),
    solution: r(byText(/^Solution$/i)),
    hard: r(document.querySelector('[data-testid="hard-button"]')),
    skip: r(document.querySelector('[data-testid="skip-button"]')),
    next: r(document.querySelector('[data-testid="next-button"]')),
    hasTheme: !!document.querySelector('[data-testid="active-theme"]'),
    hasMoveCounter: !!document.querySelector('[data-testid="move-counter"]'),
    hasMoveNav: !!document.querySelector('[data-testid="move-nav"]'),
    scrollY: Math.round(window.scrollY),
    docH: document.documentElement.scrollHeight,
  };
})()`);

async function startPuzzle() {
  await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
  await sleep(9000);
}

async function boot(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(13000);
  await ev(`localStorage.clear()`);
  await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin"]))`);
  await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1500, quickStartCount: 6 }))`);
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(16000);
  await startPuzzle();
}

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });

// ------------------------------------------------------------------ PHONE
console.log("\n=== PHONE 390x844 ===");
await boot(390, 844, true);
const ph = await measure();
console.log("measured:", JSON.stringify(ph, null, 1));
ok(!!ph.board, "a cg-board is rendered");
if (ph.board) {
  const edgeRatio = ph.board.w / ph.vw;
  const squareRatio = ph.board.w / ph.board.h;
  console.log(`  board ${ph.board.w}x${ph.board.h}  vw=${ph.vw}vh=${ph.vh}  width/vw=${edgeRatio.toFixed(3)}  w/h=${squareRatio.toFixed(3)}`);
  ok(edgeRatio >= 0.95, `board is edge-to-edge (width ${ph.board.w} >= 95% of ${ph.vw} = ${(0.95 * ph.vw).toFixed(1)})`);
  ok(squareRatio >= 0.97 && squareRatio <= 1.03, `board is square-ish (w/h ${squareRatio.toFixed(3)})`);
}
ok(ph.hasTheme, "theme label present");
ok(ph.hasMoveCounter, "move counter present");
ok(ph.hasMoveNav, "move scrub nav present");

// ---------------------------------------------------------------- DESKTOP
console.log("\n=== DESKTOP 1408x881 ===");
await boot(1408, 881, false);
const dk = await measure();
console.log("measured:", JSON.stringify(dk, null, 1));
ok(!!dk.board, "a cg-board is rendered");
if (dk.board) {
  const hRatio = dk.board.h / dk.vh;
  const wRatio = dk.board.w / dk.vw;
  const squareRatio = dk.board.w / dk.board.h;
  console.log(`  board ${dk.board.w}x${dk.board.h}  vw=${dk.vw}vh=${dk.vh}  height/vh=${hRatio.toFixed(3)}  width/vw=${wRatio.toFixed(3)}  w/h=${squareRatio.toFixed(3)}`);
  ok(hRatio >= 0.65 && hRatio <= 0.80, `board height is 65-80% of viewport height (${(hRatio * 100).toFixed(1)}%)`);
  ok(squareRatio >= 0.97 && squareRatio <= 1.03, `board is square (w/h ${squareRatio.toFixed(3)})`);
}
// Buttons must remain reachable without scrolling.
for (const [name, r] of [["Solution", dk.solution], ["Hard", dk.hard], ["Skip/Next", dk.skip ?? dk.next]]) {
  if (!r) { ok(false, `${name} button found`); continue; }
  ok(r.bottom <= dk.vh, `${name} button fully inside viewport (bottom ${r.bottom} <= ${dk.vh})`);
}
if (dk.next) ok(dk.next.bottom <= dk.vh, `Next button inside viewport (bottom ${dk.next.bottom} <= ${dk.vh})`);
ok(dk.hasTheme && dk.hasMoveCounter && dk.hasMoveNav, "chrome (theme / counter / move-nav) all present on desktop");

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0, 4).forEach((e) => console.log("   !", (e.params.exceptionDetails.exception?.description ?? "").slice(0, 200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
