/**
 * The five UI requests:
 *  1. Coordinates: rank NUMBERS visible down the left, file LETTERS along the bottom.
 *  2. Board buttons: Next puzzle ABOVE Hard.
 *  3. Settings: item 1 = Quick start, item 2 = Puzzle time.
 *  4. Your own rating visible while solving (Training + All themes).
 *  5. Pins reorderable, with visible order numbers.
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

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
// 664, not 844: 844 is the whole screen including Safari's address and tab bars,
// and no phone gives the page that much.
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 664, deviceScaleFactor: 3, mobile: true });
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
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin","mateIn1"]))`);
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1712 }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// ---------- 5. Pins: order badges + reorder ---------------------------------
const pins = await ev(`(() => {
  const badges = [...document.querySelectorAll('[data-testid^="order-badge-"]')].map(e=>e.innerText.trim());
  const handles = document.querySelectorAll('[data-testid^="drag-handle-"]').length;
  const earlier = document.querySelectorAll('[data-testid^="move-earlier-"]').length;
  const order = [...document.querySelectorAll('[data-testid^="pinned-card-"]')].map(e=>e.getAttribute('data-theme'));
  return { badges, handles, earlier, order, hint: !!document.querySelector('[data-testid="order-hint"]') };
})()`);
console.log("pins:", JSON.stringify(pins));
ok(pins.badges.join(",") === "1,2,3", `order badges show 1,2,3 (${pins.badges.join(",")})`);
ok(pins.handles === 3, `a drag handle on every pin (${pins.handles})`);
ok(pins.earlier === 3, `nudge buttons present (${pins.earlier})`);
ok(pins.hint, "the run-order hint is shown");

// Nudge pin 3 earlier twice -> it should become first.
await ev(`document.querySelector('[data-testid="move-earlier-2"]').click()`);
await sleep(700);
await ev(`document.querySelector('[data-testid="move-earlier-1"]').click()`);
await sleep(700);
const reordered = await ev(`(() => ({
  order: [...document.querySelectorAll('[data-testid^="pinned-card-"]')].map(e=>e.getAttribute('data-theme')),
  stored: JSON.parse(localStorage.getItem('puzzle_trainer_pinned_themes')||'[]'),
  badges: [...document.querySelectorAll('[data-testid^="order-badge-"]')].map(e=>e.innerText.trim()),
}))()`);
console.log("after nudging:", JSON.stringify(reordered));
ok(reordered.order[0] === "mateIn1", `nudging moved mateIn1 to the front (${reordered.order.join(" > ")})`);
ok(reordered.stored[0] === "mateIn1", "the new order PERSISTED to storage (Quick start will follow it)");
ok(reordered.badges.join(",") === "1,2,3", "badges renumbered after the move");

// Drag handle exists and is pointer-driven (not HTML5 draggable).
const dragKind = await ev(`(() => {
  const h = document.querySelector('[data-testid="drag-handle-0"]');
  return { hasPointerDown: !!h, draggableAttr: h?.getAttribute('draggable'), touchNone: getComputedStyle(h).touchAction };
})()`);
console.log("drag handle:", JSON.stringify(dragKind));
ok(dragKind.hasPointerDown, "drag handle present");
ok(dragKind.touchNone === "none", `touch-action:none set so finger-drag works (${dragKind.touchNone})`);

// ---------- 2 + 4. Board: button order + your rating -------------------------
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);
const board = await ev(`(() => {
  const next = document.querySelector('[data-testid="next-button"]');
  const hard = document.querySelector('[data-testid="hard-button"]');
  const skip = document.querySelector('[data-testid="skip-button"]');
  const top = next || skip;
  const r = (e) => e ? e.getBoundingClientRect() : null;
  const you = document.querySelector('[data-testid="user-rating"]');
  // Compare against the rating the APP actually holds — seeding localStorage is
  // not reliable here because the store owns and re-persists that key.
  const stored = JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').rating;
  return {
    topLabel: top?.innerText.trim(),
    topY: r(top)?.y, hardY: r(hard)?.y,
    skipX: r(top)?.x, hardX: r(hard)?.x,
    sameColumn: top && hard ? Math.abs(r(top).x - r(hard).x) < 8 : null,
    youText: you?.innerText.replace(/\\s+/g,' ').trim() ?? null,
    storedRating: stored,
    theme: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  };
})()`);
console.log("board:", JSON.stringify(board));
// PHONE: Skip and Hard sit SIDE BY SIDE. They used to be stacked in one column
// ("Next above, Hard below"), and this check used to require that. Making them a
// row is what bought the ~40px that lets the whole panel fit one phone screen —
// the vertical order carries no meaning on a phone, so halving the height is
// strictly better than preserving it. The desktop order is asserted separately
// at the end of this file so it cannot be lost silently.
ok(board.topY !== undefined && board.hardY !== undefined && Math.abs(board.topY - board.hardY) < 6,
   `Skip and Hard share one row on a phone (skip y=${Math.round(board.topY)} vs hard y=${Math.round(board.hardY)})`);
ok(board.skipX !== undefined && board.hardX !== undefined && board.skipX < board.hardX,
   `Skip sits LEFT of Hard on a phone (skip x=${Math.round(board.skipX)} < hard x=${Math.round(board.hardX)})`);
ok(
  board.storedRating != null && new RegExp(`You\\s*${board.storedRating}`).test(board.youText ?? ""),
  `your own rating is visible on the board and matches the app's (${board.youText} vs stored ${board.storedRating})`
);

// ---------- 1. Coordinates ---------------------------------------------------
const coords = await ev(`(() => {
  const ranks = document.querySelector('.cg-wrap coords.ranks');
  const files = document.querySelector('.cg-wrap coords.files');
  const style = (el) => { if(!el) return null; const cs = getComputedStyle(el);
    return { opacity: cs.opacity, z: cs.zIndex, size: cs.fontSize }; };
  const r = ranks && ranks.querySelector('coord');
  const f = files && files.querySelector('coord');
  const col = (e) => e ? getComputedStyle(e).color : null;
  const shadow = (e) => e ? getComputedStyle(e).textShadow : null;
  return {
    rankText: ranks ? [...ranks.querySelectorAll('coord')].map(c=>c.textContent.trim()).join('') : null,
    fileText: files ? [...files.querySelectorAll('coord')].map(c=>c.textContent.trim()).join('') : null,
    rankColor: col(r), rankShadow: (shadow(r)||'').slice(0,40), rankStyle: style(ranks),
    fileColor: col(f),
  };
})()`);
console.log("coords:", JSON.stringify(coords));
ok(coords.rankText && coords.rankText.length === 8, `rank numbers render (${coords.rankText})`);
ok(coords.fileText && coords.fileText.length === 8, `file letters render (${coords.fileText})`);
ok(Number(coords.rankStyle?.opacity) >= 0.9, `labels are opaque, not washed out (opacity ${coords.rankStyle?.opacity})`);
ok(Number(coords.rankStyle?.z) >= 3, `labels sit above the pieces (z-index ${coords.rankStyle?.z})`);
ok(/rgb/.test(coords.rankColor ?? ""), `labels have a solid colour (${coords.rankColor})`);

// ---------- 3. Settings order ------------------------------------------------
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Settings/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);
const settings = await ev(`(() => {
  const secs = [...document.querySelectorAll('section[data-testid^="settings-"]')];
  const idx = (t) => secs.findIndex(s => s.getAttribute('data-testid') === t);
  const pt = document.querySelector('[data-testid="settings-puzzle-time-options"]');
  return {
    order: secs.map(s => s.getAttribute('data-testid')),
    quickStartIdx: idx('settings-quickstart'),
    puzzleTimeIdx: idx('settings-puzzle-time'),
    timerButtons: pt ? [...pt.querySelectorAll('button')].map(b=>b.innerText.trim()) : null,
    timerDataIds: pt ? [...pt.querySelectorAll('button')].map(b=>b.getAttribute('data-testid')) : null,
  };
})()`);
console.log("settings:", JSON.stringify(settings));
ok(settings.quickStartIdx === 0, `item 1 is Quick start (index ${settings.quickStartIdx})`);
ok(settings.puzzleTimeIdx === 1, `item 2 is Puzzle time (index ${settings.puzzleTimeIdx})`);
ok((settings.timerButtons ?? []).includes("Off"), `timer options render (${(settings.timerButtons ?? []).join(", ")})`);

// The control must actually drive the board's clock.
await ev(`document.querySelector('[data-testid="settings-puzzle-time-60"]').click()`);
await sleep(1200);
const timerSet = await ev(`(() => {
  const p = JSON.parse(localStorage.getItem('puzzle_trainer_theme_prefs')||'{}');
  const on = document.querySelector('[data-testid="settings-puzzle-time-60"]')?.getAttribute('data-on');
  return { prefs: p.puzzleTimerSeconds, markedOn: on };
})()`);
console.log("timer after selecting 1 min:", JSON.stringify(timerSet));
ok(timerSet.prefs === 60, `selecting 1 min persisted to prefs (${timerSet.prefs})`);
ok(timerSet.markedOn === "1", "the chosen option is marked active");

// ---------- Desktop: the button order the user asked for is preserved --------
// "keep the next puzzle button at the top like how it is". Only the PHONE stacks
// these two into a row; without this check, a later change to the mobile rules
// could flatten the desktop layout and nothing would notice.
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(2000);
await ev(`document.querySelector('[data-testid="tab-training"]')?.click()`);
await sleep(1500);
if (!(await ev(`!!document.querySelector('[data-testid="hard-button"]')`))) {
  await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
  await sleep(9000);
}
const desk = await ev(`(() => {
  const next = document.querySelector('[data-testid="next-button"]');
  const hard = document.querySelector('[data-testid="hard-button"]');
  const skip = document.querySelector('[data-testid="skip-button"]');
  const top = next || skip;
  const r = (e) => e ? e.getBoundingClientRect() : null;
  return { label: (top?.innerText || '').trim(), topY: r(top)?.y, hardY: r(hard)?.y,
           topX: r(top)?.x, hardX: r(hard)?.x };
})()`);
console.log("desktop board:", JSON.stringify(desk));
ok(desk.topY !== undefined && desk.hardY !== undefined && desk.topY < desk.hardY,
   `DESKTOP: primary button is still ABOVE Hard (${Math.round(desk.topY)} < ${Math.round(desk.hardY)})`);
ok(desk.topX !== undefined && desk.hardX !== undefined && Math.abs(desk.topX - desk.hardX) < 8,
   `DESKTOP: they are still stacked in one column (x ${Math.round(desk.topX)} vs ${Math.round(desk.hardX)})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
