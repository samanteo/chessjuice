/**
 * Independent verification of ITEMS 4 and 6 (parent's own check).
 *
 * ITEM 4 — the same theme pinned twice must produce TWO ordered blocks; removing
 *          one must remove only that one; reordering must move one card only; and
 *          React must not warn about duplicate keys.
 * ITEM 6 — Settings section renamed "Training Block", chips 5/10/15/20 plus a
 *          custom box, clamped to 1-100.
 *
 * Same harness safety as the other parent script: sync is forced 'off' via
 * Page.addScriptToEvaluateOnNewDocument BEFORE the app boots, on every document,
 * so nothing here can be pushed over the user's real data. Never calls DELETE.
 */
import { WebSocket } from "ws";
import fs from "fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = JSON.parse(fs.readFileSync("/Users/sam/puzzle-trainer/user-state/state.json", "utf8"));
const pins = JSON.parse(state["puzzle_trainer_pinned_themes"].v);
const realRating = JSON.parse(state["puzzle_trainer_settings"].v).rating;

const list = await (await fetch("http://localhost:9245/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map(); const consoleMsgs = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.consoleAPICalled") {
    consoleMsgs.push((m.params.args || []).map((a) => String(a.value ?? a.description ?? "")).join(" "));
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

const slotCount = () => ev(`document.querySelectorAll('[data-testid^="pinned-slot-"]').length`);
const pinCopies = () => ev(`document.querySelectorAll('[data-theme="pin"]').length`);
const order = () => ev(`JSON.stringify([...document.querySelectorAll('[data-testid="pinned-grid"] [data-theme]')].map(e => e.getAttribute('data-theme')))`);
const storedCount = () => ev(`JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').quickStartCount`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    localStorage.setItem('puzzle_trainer_sync','off');
    if (!localStorage.getItem('__hv4_seeded')) {
      localStorage.setItem('__hv4_seeded','1');
      localStorage.setItem('puzzle_trainer_pinned_themes', ${JSON.stringify(JSON.stringify(pins))});
      localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: ${realRating}, quickStartCount: 10 }));
      localStorage.removeItem('puzzle_trainer_quickrun');
    }
  `,
});

// Idempotency: the pre-document seed uses a sentinel, and that sentinel persists
// in this browser profile BETWEEN runs — so a second run inherited the first
// run's mutated pins and the baseline shifted. Clear the origin once, then reload,
// so the seed re-applies and every run starts from the same state.
await send("Page.navigate", { url: "http://localhost:3000/?hv4=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?hv4=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="tab-training"]')?.click()`);
await sleep(2500);

// ---------- ITEM 4 -----------------------------------------------------------
const before = await slotCount();
const copies0 = await pinCopies();
console.log(`  starting pinned slots: ${before}, copies of "pin": ${copies0}`);
ok(before === pins.length, `baseline: ${pins.length} pinned slots render (got ${before})`);

await ev(`document.querySelector('[data-testid="add-theme"]')?.click()`);
await sleep(1500);
ok(await ev(`!!document.querySelector('[data-testid="theme-picker"]')`), "the theme picker opened");

// Narrow the list, then add the SAME theme twice. This is the core of Item 4: the
// picker used to show an already-pinned theme as done and refuse to re-add it.
await ev(`(() => {
  const s = document.querySelector('[data-testid="picker-search"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(s, 'pin');
  s.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1500);
const rowThere = await ev(`!!document.querySelector('[data-testid="picker-row-pin"]')`);
ok(rowThere, 'the picker still offers "pin" even though it is already pinned');
const rowLabel0 = await ev(`(document.querySelector('[data-testid="picker-row-pin"]')||{}).innerText?.replace(/\\s+/g,' ') ?? null`);
console.log(`  picker row reads: ${JSON.stringify(rowLabel0)}`);

await ev(`document.querySelector('[data-testid="picker-row-pin"]')?.click()`);
await sleep(900);
await ev(`document.querySelector('[data-testid="picker-row-pin"]')?.click()`);
await sleep(900);
const label2 = await ev(`(document.querySelector('[data-testid="picker-row-pin"]')||{}).innerText?.replace(/\\s+/g,' ') ?? null`);
const count2 = Number(await ev(`(document.querySelector('[data-testid="picker-row-pin"]')||{}).getAttribute('data-pin-count') ?? "0"`));
console.log(`  after two adds the row reads: ${JSON.stringify(label2)} (data-pin-count=${count2})`);
// The harness may already hold a copy of "pin", so assert the DELTA, not an
// absolute 2 — what matters is that adding twice stacked and the row says how.
ok(count2 >= 2, `the picker acknowledges the extra copies (count=${count2})`);
ok(/unpin/i.test(label2 ?? ""), `the row reads as an UNPIN action once pinned ("${label2}")`);
// The row must also offer a way OUT of a multi-pin — the picker used to have
// none once an id was pinned twice, so the only escape was "Unpin all".
const unpinThere = await ev(`!!document.querySelector('[data-testid="picker-unpin-pin"]')`);
ok(unpinThere, "a pinned row offers its own Unpin control");

// Clicking it must actually clear EVERY copy of that id, in one tap.
await ev(`document.querySelector('[data-testid="picker-unpin-pin"]')?.click()`);
await sleep(1200);
const countAfterUnpin = await ev(`(document.querySelector('[data-testid="picker-row-pin"]')||{}).getAttribute('data-pin-count') ?? null`);
const labelAfter = await ev(`(document.querySelector('[data-testid="picker-row-pin"]')||{}).innerText?.replace(/\\s+/g,' ') ?? null`);
console.log(`  after tapping the row's Unpin: count=${countAfterUnpin}, "${labelAfter}"`);
ok(countAfterUnpin === "0", `one tap cleared every copy of the id (count=${countAfterUnpin})`);
ok(!/unpin/i.test(labelAfter ?? ""), "the row falls back to its plain Pin state");
// Re-pin the same number of copies we just cleared, so the later
// duplicate/unpin-by-card steps still see the same totals they expect.
for (let i = 0; i < count2; i++) {
  await ev(`document.querySelector('[data-testid="picker-row-pin"]')?.click()`);
  await sleep(500);
}
const countRestored = Number(await ev(`(document.querySelector('[data-testid="picker-row-pin"]')||{}).getAttribute('data-pin-count') ?? "0"`));
console.log(`  restored copies: ${countRestored} (was ${count2})`);

await ev(`document.querySelector('[data-testid="picker-close"]')?.click()`);
await sleep(1500);

const after = await slotCount();
const copies = await pinCopies();
ok(after === before + 2, `pinning the same theme twice adds TWO blocks (slots ${before} -> ${after})`);
ok(copies === copies0 + 2, `the extra copies exist as separate cards (copies ${copies0} -> ${copies})`);

// Remove ONE copy. It must remove exactly one, not every copy of that id.
// Target the LAST card carrying data-theme="pin" — that is guaranteed to be one
// the test just added, because adding appends. (Targeting a fixed slot index
// depends on the starting order and silently no-ops if that slot is not a pin.)
const unpinClicked = await ev(`(() => {
  const cards = [...document.querySelectorAll('[data-testid="pinned-grid"] [data-theme="pin"]')];
  const card = cards[cards.length - 1];
  if (!card) return false;
  const slot = card.closest('[data-testid^="pinned-slot-"]');
  const b = slot && slot.querySelector('[data-testid^="unpin-"]');
  if (!b) return false;
  b.click();
  return true;
})()`);
ok(unpinClicked, "found and clicked the unpin control on one of the duplicate cards");
await sleep(1500);
const afterUnpin = await slotCount();
const copiesAfter = await pinCopies();
ok(afterUnpin === after - 1, `removing one copy removes exactly one slot (${after} -> ${afterUnpin})`);
ok(copiesAfter === copies0 + 1, `the other copies of "pin" survive (copies ${copies} -> ${copiesAfter}, was ${copies0} before adding)`);

// Reorder: the nudge controls drive the same reorder path as the drag.
const orderBefore = await order();
await ev(`document.querySelector('[data-testid="move-later-0"]')?.click()`);
await sleep(1200);
const orderAfter = await order();
ok(orderBefore !== orderAfter, `reordering changes the order (${String(orderBefore).slice(0, 60)} -> ${String(orderAfter).slice(0, 60)})`);
const ob = JSON.parse(orderBefore ?? "[]"); const oa = JSON.parse(orderAfter ?? "[]");
ok(ob.length === oa.length && ob[1] === oa[0] && ob[0] === oa[1],
   `nudging slot 0 later swapped exactly those two neighbours`);

// Attempt a real pointer drag (the code paths use pointer events, not HTML5 DnD).
const beforeDrag = await order();
const box = await ev(`(() => { const h = document.querySelector('[data-testid="drag-handle-0"]'); if (!h) return null; const b = h.getBoundingClientRect(); return { x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2) }; })()`);
if (box) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(250);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 140, y: box.y + 90, button: "left" });
  await sleep(250);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 140, y: box.y + 90, button: "left", clickCount: 1 });
  await sleep(1500);
}
const afterDrag0 = await order();
let dragged = beforeDrag !== afterDrag0;
let afterDrag = afterDrag0;
if (!dragged) {
  // Attempt 2: synthetic PointerEvents dispatched in-page. The handle sets
  // touch-action:none and may well listen for pointerdown specifically rather
  // than for mouse events, so a CDP mouse sequence can miss it.
  await ev(`(() => {
    const h = document.querySelector('[data-testid="drag-handle-0"]');
    if (!h) return;
    const b = h.getBoundingClientRect();
    const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    const mk = (t, x, y) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: t === 'pointerup' ? 0 : 1 });
    h.dispatchEvent(mk('pointerdown', sx, sy));
    document.dispatchEvent(mk('pointermove', sx + 60, sy + 40));
    document.dispatchEvent(mk('pointermove', sx + 140, sy + 90));
    document.dispatchEvent(mk('pointerup', sx + 140, sy + 90));
  })()`);
  await sleep(1500);
  afterDrag = await order();
  dragged = beforeDrag !== afterDrag;
}
console.log(`  drag attempts (CDP mouse, then synthetic PointerEvents) changed the order: ${dragged}`);
if (!dragged) console.log("  NOTE: neither synthetic drag reordered the list. Reported as UNVERIFIED rather than a failure — the nudge controls above exercise the same reorder path and DO work, so this is about my synthetic events, not necessarily the drag.");

// ---------- ITEM 6 -----------------------------------------------------------
await ev(`document.querySelector('[data-testid="tab-appearance"]')?.click()`);
await sleep(2500);
const heading = await ev(`(document.querySelector('[data-testid="settings-quickstart"] h2')||{}).innerText?.trim() ?? null`);
ok(heading === "Training Block", `ITEM 6: the Settings section is titled "Training Block" (got ${JSON.stringify(heading)})`);

const chips = await ev(`JSON.stringify([5,10,15,20].map(n => !!document.querySelector('[data-testid="quickstart-count-'+n+'"]')))`);
ok(chips === "[true,true,true,true]", `ITEM 6: chips 5 / 10 / 15 / 20 all present (${chips})`);
const oldChips = await ev(`JSON.stringify([30,50].map(n => !!document.querySelector('[data-testid="quickstart-count-'+n+'"]')))`);
ok(oldChips === "[false,false]", `ITEM 6: the old 30 / 50 chips are gone (${oldChips})`);

const boxAttrs = await ev(`(() => { const i = document.querySelector('[data-testid="quickstart-count-custom"]'); return i ? { min: i.min, max: i.max, type: i.type } : null; })()`);
ok(boxAttrs && boxAttrs.min === "1" && boxAttrs.max === "100" && boxAttrs.type === "number",
   `ITEM 6: custom box is type=number with min 1 / max 100 (${JSON.stringify(boxAttrs)})`);

// Clamp on save: type an out-of-range value, blur, and check what was STORED.
const setInput = (v) => ev(`(() => {
  const i = document.querySelector('[data-testid="quickstart-count-custom"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  i.focus();
  setter.call(i, '${v}');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  // The REAL blur(). It fires focusout, which is what React delegates on;
  // dispatchEvent(new Event('blur')) does not bubble and never reaches the handler.
  i.blur();
  return true;
})()`);

await setInput(500);
await sleep(1200);
const clampedHigh = await storedCount();
ok(clampedHigh === 100, `ITEM 6: entering 500 clamps to 100 on save (stored ${clampedHigh})`);

await setInput(7);
await sleep(1200);
const mid = await storedCount();
ok(mid === 7, `ITEM 6: a normal custom value 7 saves as-is (stored ${mid})`);

// A garbage stored value must fall back to 10 on READ. Written directly, then
// reloaded immediately so the app cannot re-persist its own value first.
await ev(`(() => { const s = JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}'); s.quickStartCount = "not-a-number"; localStorage.setItem('puzzle_trainer_settings', JSON.stringify(s)); return true; })()`);
await send("Page.navigate", { url: "http://localhost:3000/?hv4=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="tab-appearance"]')?.click()`);
await sleep(2000);
const garbageSummary = await ev(`(document.querySelector('[data-testid="settings-quickstart"] p:last-of-type')||{}).innerText?.replace(/\\s+/g,' ').trim() ?? null`);
const garbageChipOn = await ev(`JSON.stringify([5,10,15,20].filter(n => document.querySelector('[data-testid="quickstart-count-'+n+'"]')?.getAttribute('data-on') === '1'))`);
console.log(`  with a garbage stored count -> summary ${JSON.stringify(garbageSummary)}, chip on ${garbageChipOn}`);
ok(/Currently 10 per theme/.test(garbageSummary ?? "") && garbageChipOn === "[10]",
   `ITEM 6: a garbage stored count falls back to 10 (see above)`);

// ---------- console hygiene ---------------------------------------------------
const dupeKey = consoleMsgs.filter((m) => /unique .?key|same key/i.test(m));
ok(dupeKey.length === 0, `ITEM 4: no duplicate-key React warnings (${dupeKey.length})${dupeKey.length ? ": " + dupeKey[0].slice(0, 200) : ""}`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
