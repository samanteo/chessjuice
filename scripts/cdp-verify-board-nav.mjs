/**
 * Verify the reworked board foot (this session):
 *   1. No control in the move-nav row overlaps another (the "Next puzzle paints
 *      over ▶" bug), and the row does not overflow horizontally.
 *   2. The position counter stays on ONE line.
 *   3. The old orange "Back to position" button is GONE, and the counter is the
 *      way back to the live position (data-live flips).
 *   4. The failed banner reads exactly "Puzzle failed".
 *   5. The board is edge-to-edge (width >= 98% of viewport) at 390 AND 360.
 * Checks both widths because a row that fits at 390 can still overflow at 360.
 */
import { WebSocket } from "ws";
import { writeFileSync } from "fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`/tmp/ui-${name}.png`, Buffer.from(r.result.data, "base64")); console.log(`shot: /tmp/ui-${name}.png`); };

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const measure = () => ev(`(() => {
  const R = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const nav = document.querySelector('[data-testid="move-nav"]');
  const counter = document.querySelector('[data-testid="move-nav-position"]');
  const fb = document.querySelector('.board-feedback');
  return {
    vw: innerWidth, vh: innerHeight, clientW: document.documentElement.clientWidth,
    board: R('cg-board'),
    panel: R('.board-panel'),
    stage: R('[data-testid="board-stage"]'),
    wrapper: R('.chessground-wrapper'),
    cgwrap: R('.cg-wrap'),
    nav: R(nav), navScroll: nav ? { sw: nav.scrollWidth, cw: nav.clientWidth } : null,
    solution: R(document.querySelector('[data-testid="solution-button"]')),
    next: R(document.querySelector('[data-testid="next-button"]')),
    back: R(document.querySelector('[data-testid="move-back"]')),
    forward: R(document.querySelector('[data-testid="move-forward"]')),
    counter: R(counter),
    counterLines: counter ? Math.round(counter.getBoundingClientRect().height / parseFloat(getComputedStyle(counter).lineHeight || 16)) : null,
    movePill: R(document.querySelector('[data-testid="move-counter"]')),
    liveBtn: !!document.querySelector('[data-testid="move-live"]'),
    dataLive: counter ? counter.getAttribute('data-live') : null,
    feedbackText: fb ? fb.innerText.trim() : null,
    feedbackH: fb ? Math.round(fb.getBoundingClientRect().height) : null,
  };
})()`);

const overlaps = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

async function boot(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
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
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(12000);
  await ev(`localStorage.clear()`);
  await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
  await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin"]))`);
  await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1500, quickStartCount: 6 }))`);
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(15000);
  await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
  await sleep(9000);
}

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });

for (const [w, h, mobile] of [[390, 844, true], [360, 800, true]]) {
  console.log(`\n=== ${w}x${h} ===`);
  await boot(w, h, mobile);
  await shot(`playing-${w}`);
  // Failed state: the worst case for the row (Solution + Next + scrub nav).
  await ev(`document.querySelector('[data-testid="solution-button"]')?.click()`);
  await sleep(3500);
  const m = await measure();
  console.log(JSON.stringify(m, null, 1));
  await shot(`nav-${w}`);

  ok(m.board && m.board.w >= 0.98 * m.vw, `board edge-to-edge (${m.board?.w} >= 98% of ${m.vw})`);
  ok(m.board && Math.abs(m.board.w - m.board.h) <= 4, `board square (${m.board?.w}x${m.board?.h})`);
  ok(m.navScroll && m.navScroll.sw <= m.navScroll.cw + 1, `move-nav row does not overflow (scrollW ${m.navScroll?.sw} <= clientW ${m.navScroll?.cw})`);
  for (const [a, b] of [["solution","next"],["solution","counter"],["next","back"],["next","forward"],["next","counter"],["back","forward"],["forward","counter"]]) {
    ok(!overlaps(m[a], m[b]), `${a} does not overlap ${b}`);
  }
  ok(m.counterLines === 1, `counter is on one line (${m.counterLines})`);
  ok(m.liveBtn === false, `old "Back to position" button is gone`);
  ok(m.feedbackText === "Puzzle failed", `failed banner reads exactly "Puzzle failed" (got "${m.feedbackText}")`);
  ok(m.feedbackH !== null && m.feedbackH <= 44, `failed banner is one compact line (${m.feedbackH}px)`);
  // At 390+ the head must NOT clip the "Move X of Y" pill (it is how you know a
  // multi-move puzzle is finished). The one-row pill rule is <=380px only.
  if (w >= 390) ok(m.movePill && m.movePill.r <= m.vw + 1, `"Move X of Y" pill fully visible (right ${m.movePill?.r} <= ${m.vw})`);
  // The counter must act as "back to live": scrubbing => data-live=false; tap => true.
  ok(m.dataLive === "false", `counter shows data-live=false while reviewing (got ${m.dataLive})`);
  await ev(`document.querySelector('[data-testid="move-nav-position"]').click()`);
  await sleep(600);
  const after = await ev(`document.querySelector('[data-testid="move-nav-position"]').getAttribute('data-live')`);
  ok(after === "true", `tapping the counter returns to the live position (data-live=${after})`);
}

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0, 4).forEach((e) => console.log("   !", (e.params.exceptionDetails.exception?.description ?? "").slice(0, 200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close(); process.exit(fail ? 1 : 0);
