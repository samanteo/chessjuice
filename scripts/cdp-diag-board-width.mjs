/**
 * How wide is the board at REALISTIC phone viewport heights?
 *
 * My earlier verification measured at 390x844 and reported "full-bleed". 844 is
 * the FULL screen including Safari's address/tab bars; the usable viewport is
 * ~660-700. Since `.board-frame` is sized from `100vh`, a shorter viewport makes
 * the board HEIGHT-limited, and it shrinks away from the edges — which is exactly
 * what the user keeps reporting ("board still small, need it to touch the borders").
 *
 * This measures the board width as a percentage of the screen across the range of
 * heights a real phone actually has.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");

async function boot(h) {
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: h, deviceScaleFactor: 3, mobile: true });
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
  await send("Page.navigate", { url: "http://localhost:3000/?p=" + Date.now() + Math.random() });
  await sleep(12000);
  await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off');
            localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin"]))`);
  await send("Page.navigate", { url: "http://localhost:3000/?p=" + Date.now() });
  await sleep(14000);
  await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
  await sleep(8500);
}

const m = () => ev(`(() => {
  const b = document.querySelector('cg-board');
  const r = b ? b.getBoundingClientRect() : null;
  const frame = document.querySelector('.board-frame');
  const head = document.querySelector('.board-panel__head');
  const foot = document.querySelector('.board-panel__foot');
  const pips = document.querySelector('.board-panel__progress');
  const hb = document.querySelector('[data-testid="hard-button"]');
  const R = (e) => e ? Math.round(e.getBoundingClientRect().bottom) : null;
  return {
    vh: innerHeight,
    boardW: r ? Math.round(r.width) : null,
    pctW: r ? +(r.width / innerWidth * 100).toFixed(1) : null,
    frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    footH: foot ? Math.round(foot.getBoundingClientRect().height) : null,
    pipsBottom: R(pips), hardBottom: R(hb),
    docH: document.documentElement.scrollHeight,
  };
})()`);

console.log("\n  viewport    board    %ofWidth   frame  head  foot   pips@   hard@   docH");
for (const h of [600, 640, 664, 700, 730, 760, 800, 844]) {
  await boot(h);
  const x = await m();
  console.log(
    "  390x" + String(h).padEnd(9) +
    String(x.boardW).padEnd(9) +
    String(x.pctW + "%").padEnd(11) +
    String(x.frameH).padEnd(6) + String(x.headH).padEnd(6) + String(x.footH).padEnd(7) +
    String(x.pipsBottom).padEnd(8) + String(x.hardBottom).padEnd(8) + String(x.docH)
  );
}
ws.close(); process.exit(0);
