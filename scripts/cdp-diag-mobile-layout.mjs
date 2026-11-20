/**
 * Measures the mobile/desktop layout for Training and Review, so the fixes target
 * real numbers instead of guesses from screenshots.
 *
 * One real session: start clean -> train a puzzle -> fail it (which creates a due
 * mistake) -> review it. Review needs something DUE, so clearing storage before
 * each measurement would leave it with nothing to show.
 *
 * Reports per context: initial scroll position (the "loads scrolled down" bug),
 * board geometry, and whether the session strip overlaps any control.
 *
 * Usage: node scripts/cdp-diag-mobile-layout.mjs [port] [width] [height]
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = Number(process.argv[2] || 9245);
const WIDTH = Number(process.argv[3] || 390);
const HEIGHT = Number(process.argv[4] || 844);

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const click = (re) => ev(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.innerText||'').trim()) && x.offsetParent!==null);
  if(!b) return false; b.click(); return true; })()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: WIDTH < 700 });

const measure = (ctx) => ev(`(() => {
  const rr = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return {x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height),
            bottom:Math.round(b.bottom), right:Math.round(b.right)}; };
  const btn = (re) => [...document.querySelectorAll('button')].find(x=>re.test((x.innerText||'').trim()) && x.offsetParent!==null);
  return {
    scrollY: Math.round(window.scrollY),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    panel: rr(document.querySelector('[data-board-context="${ctx}"]')),
    board: rr(document.querySelector('cg-board')),
    head: rr(document.querySelector('.board-panel__head')),
    strip: rr(document.querySelector('[data-testid="session-strip"]')),
    solution: rr(btn(/^Solution$/i)),
    skipNext: rr(btn(/Skip puzzle|Next puzzle|Tap again to skip/i)),
    hard: rr(btn(/Hard/i)),
    pips: rr(document.querySelector('.board-panel__progress')),
    feedback: rr(document.querySelector('.board-feedback')),
  };
})()`);

const overlap = (a, b) => {
  if (!a || !b) return null;
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return x > 0 && y > 0 ? { w: x, h: y } : null;
};

function report(label, started, m) {
  console.log(`\n===== ${label} (${WIDTH}x${HEIGHT}) · started=${started} =====`);
  if (!m.board) { console.log("  no board rendered"); return m; }
  console.log("  scrollY:", m.scrollY, m.scrollY > 4 ? "<-- LOADED SCROLLED (bug)" : "(top)");
  console.log("  head   :", JSON.stringify(m.head));
  console.log("  board  :", JSON.stringify(m.board));
  console.log("  strip  :", JSON.stringify(m.strip));
  console.log("  solution:", JSON.stringify(m.solution), " skipNext:", JSON.stringify(m.skipNext), " hard:", JSON.stringify(m.hard));
  console.log("  pips   :", JSON.stringify(m.pips));
  for (const [n, o] of [
    ["strip x Solution", overlap(m.strip, m.solution)],
    ["strip x Skip/Next", overlap(m.strip, m.skipNext)],
    ["strip x Hard", overlap(m.strip, m.hard)],
    ["strip x pips", overlap(m.strip, m.pips)],
    ["strip x feedback", overlap(m.strip, m.feedback)],
  ]) console.log(`  ${n}: ${o ? "*** OVERLAP " + JSON.stringify(o) : "clear"}`);
  console.log(`  board = ${m.board.w}x${m.board.h} (${Math.round((m.board.h / m.viewport.h) * 100)}% of viewport height), centred? x=${m.board.x} viewport=${m.viewport.w}`);
  return m;
}

// ---- session ----
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
await send("Page.navigate", { url: "http://localhost:3000/?m=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off');
          localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork']));`);
await send("Page.navigate", { url: "http://localhost:3000/?m2=" + Date.now() });
await sleep(15000);

// Select by testid, not label text: the button now reads "Start new" / "Continue
// N / M" depending on state, so text matching is unreliable.
const startedT = await ev(`(() => { const b=document.querySelector('[data-testid="quickstart-button"]'); if(!b) return false; b.click(); return true; })()`);
await sleep(9000);
const m1 = report("TRAINING", startedT, await measure("training"));

await click(/^Solution$/i);
await sleep(4000);

await ev(`document.querySelector('[data-testid="tab-mistakes"]')?.click()`);
await sleep(2500);
const startedR = await click(/Review Due/i);
await sleep(5000);
const m2 = report("REVIEW", startedR, await measure("review"));

console.log("\n===== comparison =====");
console.log("training board:", JSON.stringify(m1.board));
console.log("review   board:", JSON.stringify(m2.board));
console.log("same size?", m1.board?.w === m2.board?.w && m1.board?.h === m2.board?.h);
ws.close();
