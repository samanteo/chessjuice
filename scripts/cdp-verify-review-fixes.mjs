/**
 * Verifies the review-end + review-layout + session-strip fixes through the
 * REAL USER FLOW, with no localStorage seeding:
 *
 *   train a puzzle -> get it wrong (it becomes a due mistake) -> Review tab
 *   -> "Review Due" -> finish it -> the queue is empty, so the board must CLEAR
 *   and show "Review complete" (previously: stuck on the last puzzle forever).
 *
 * Also asserts the Review board is board-first (no sidebar, controls on screen)
 * and that the session strip now sits between Solution and Skip with a visible
 * background.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const clickBtn = (re) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => ${re}.test((x.innerText||'').trim()) && x.offsetParent !== null);
  if (!b) return false; b.click(); return true;
})()`);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
// 664, not 844: 844 is the whole screen including Safari's address and tab bars,
// and no phone gives the page that much. Testing at 844 is what let a board that
// was really 55% of the width pass a "full-bleed" check.
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 664, deviceScaleFactor: 3, mobile: true });

// Clean slate on both sides.
await fetch("http://localhost:3000/api/state?confirm=1", { method: "DELETE" }).catch(() => {});
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
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork']))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);

// ---- 1. Train a puzzle and FAIL it, so it becomes a due mistake ----
// Select by testid, not label text: the button is now state-dependent
// ("Start new" / "Continue N / M"), so text matching is unreliable.
const started = await ev(`(() => { const b=document.querySelector('[data-testid="quickstart-button"]'); if(!b) return false; b.click(); return true; })()`);
ok(started, "Quick start is available");
await sleep(9000);
const boardFirst = await ev(`!!document.querySelector('[data-board-context="training"]')`);
ok(boardFirst, "a training puzzle is on the board");

await clickBtn(`/^Solution$/i`);
await sleep(4000);
const scored = await ev(`(() => {
  const prog = JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2') || '{}');
  const vals = Object.values(prog);
  return { entries: vals.length, wrong: vals.filter(p=>p.isWrongPuzzle).length,
           dueNow: vals.filter(p=>p.isWrongPuzzle && p.rung <= 0).length };
})()`);
console.log("after failing one:", JSON.stringify(scored));

// The session strip lives on the TRAINING board (it pages back through the
// training batch) — assert it there, in the middle of the action row.
const t = await ev(`(() => {
  const strip = document.querySelector('[data-testid="session-strip"]');
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bottom:Math.round(b.bottom)}; };
  const sol = [...document.querySelectorAll('button')].find(b=>/^Solution$/i.test(b.innerText.trim()));
  const skip = document.querySelector('[data-testid="next-button"]') || document.querySelector('[data-testid="skip-button"]');
  const cs = strip ? getComputedStyle(strip) : null;
  // Buttons in the FOOT specifically, excluding the strip's own prev/next arrows.
  // Using next-button for the horizontal check is a trap: in the FAILED state it
  // lives in the move-nav row ABOVE (x~92), so comparing against it says nothing
  // about whether the strip overlaps the buttons it actually shares a row with.
  const foot = document.querySelector('.board-panel__foot');
  const footLeft = foot
    ? Math.min(...[...foot.querySelectorAll('button')]
        .filter(b => !strip || !strip.contains(b))
        .map(b => Math.round(b.getBoundingClientRect().x)))
    : null;
  return { boardUp: !!document.querySelector('[data-board-context="training"]'),
           sol: r(sol), skip: r(skip), strip: r(strip), stripBg: cs ? cs.backgroundColor : null,
           footLeft,
           movenav: r(document.querySelector('[data-testid="move-nav"]')),
           hard: r(document.querySelector('[data-testid="hard-button"]')) };
})()`);
console.log("training foot:", JSON.stringify(t));
ok(t.strip !== null, "session strip renders inside the TRAINING board foot");
// The strip sits BETWEEN the move-scrub row above it (Solution / ◀ ▶, which §87
// moved up there) and the Skip/Hard column below it. It must not collide with
// either. The old assertion was "its bottom is above EVERY button's top", which
// was written when Solution still lived in the foot; once Solution moved into the
// move-nav row that became false by design, not a regression.
ok(t.strip && t.movenav && t.strip.y >= t.movenav.bottom,
   `strip is clear of the move-scrub row above it (strip top ${t.strip?.y} >= move-nav bottom ${t.movenav?.bottom})`);
// NOTE: `skip` above resolves to `next-button`, which in the FAILED state lives
// in the move-nav row ABOVE the strip — so assertions about the strip's
// relationship to the BUTTONS must use HARD / skip-button, which share its row.
//
// The strip SHARES THE ROW with Skip/Hard now. It used to be on its own row
// directly above them, and this check used to require that ("strip bottom <=
// Hard top"). The fold is deliberate: its own row cost ~40px, which was exactly
// the difference between the whole panel fitting one phone screen and its last
// row (the progress pips) falling below the fold. So the assertion is now "same
// row, and to the LEFT of the buttons rather than over them".
const btnLeft = t.footLeft; // buttons that actually share the strip's row
const rowOverlap = t.strip && t.hard
  ? Math.min(t.strip.bottom, t.hard.bottom) - Math.max(t.strip.y, t.hard.y)
  : -1;
ok(rowOverlap >= 24,
   `strip shares the button row (${rowOverlap}px of vertical overlap with Skip/Hard)`);
ok(t.strip && btnLeft != null && t.strip.x + t.strip.w <= btnLeft + 1,
   `strip sits LEFT of the buttons, not over them (strip right ${t.strip ? t.strip.x + t.strip.w : "?"} <= buttons left ${btnLeft})`);
ok(!!t.stripBg && t.stripBg !== "rgba(0, 0, 0, 0)" && t.stripBg !== "transparent",
   `strip has a visible background, not the page colour (${t.stripBg})`);

// ---- 2. Review tab: queue has work, so "Review Due" is offered ----
await ev(`document.querySelector('[data-testid="tab-mistakes"]')?.click()`);
await sleep(2500);
const dueOffered = await ev(`[...document.querySelectorAll('button')].some(b=>/Review Due/i.test(b.innerText||''))`);
ok(dueOffered, "the Review tab offers 'Review Due' now that something is due");

// ---- 3. Start it, then finish the LAST due puzzle ----
if (dueOffered) {
  await clickBtn(`/Review Due/i`);
  await sleep(4000);
}

const layout = await ev(`(() => {
  const aside = document.querySelector('aside');
  const board = document.querySelector('[data-board-context="review"]');
  const strip = document.querySelector('[data-testid="session-strip"]');
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bottom:Math.round(b.bottom)}; };
  const sol = [...document.querySelectorAll('button')].find(b=>/^Solution$/i.test(b.innerText.trim()));
  const skip = document.querySelector('[data-testid="next-button"]') || document.querySelector('[data-testid="skip-button"]');
  const cs = strip ? getComputedStyle(strip) : null;
  return { asideVisible: !!(aside && aside.offsetParent !== null), boardUp: !!board,
           sol: r(sol), skip: r(skip), strip: r(strip), stripBg: cs ? cs.backgroundColor : null,
           viewportH: window.innerHeight };
})()`);
console.log("review layout:", JSON.stringify(layout));
ok(layout.boardUp, "a due mistake is on the review board");
ok(!layout.asideVisible, "Review hides the left sidebar while a board is up (was: always shown)");
ok(layout.skip && layout.skip.y + layout.skip.h <= layout.viewportH,
   `Next/Skip reachable without scrolling (bottom ${layout.skip ? layout.skip.y + layout.skip.h : '?'} <= ${layout.viewportH})`);

// Finish the last due puzzle.
await clickBtn(`/^Solution$/i`);
await sleep(4000);
const nextAvail = await ev(`!!document.querySelector('[data-testid="next-button"]')`);
ok(nextAvail, "once resolved, 'Next puzzle' is available");
if (nextAvail) { await ev(`document.querySelector('[data-testid="next-button"]').click()`); await sleep(4000); }

const after = await ev(`(() => ({ gone: !document.querySelector('[data-board-context="review"]'), text: document.body.innerText }))()`);
ok(after.gone, "finishing the LAST due puzzle CLEARS the board (was: stuck on it forever)");
ok(/Review complete/i.test(after.text), "and shows the 'Review complete' state");
ok(/Nothing is due right now/i.test(after.text), "with an explanation");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
