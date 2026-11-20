/**
 * The one thing left unproven: dragging a pinned card actually reorders it.
 *
 * Why the earlier attempts failed (now understood from the source):
 *   onHandleDown -> e.currentTarget.setPointerCapture(e.pointerId)
 * A synthetic PointerEvent carries a fabricated pointerId, and you cannot capture
 * a pointer that does not exist — so the handler aborts before dragIndex is set,
 * and no drag can ever be seen by the grid's onPointerMove. Real input dispatched
 * through CDP goes through the browser's own input pipeline and HAS a real
 * pointer id, so it should work where dispatchEvent() could not.
 *
 * Also note onGridMove resolves the drop target with
 * document.elementFromPoint(...).closest("[data-index]"), so the pointer must end
 * up genuinely OVER another card. Aiming at a computed neighbouring card centre
 * (not a blind +140/+90 offset) is what makes this a real test.
 *
 * Harness safety: sync forced 'off' before the app boots, on every document.
 * Never calls DELETE /api/state.
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
  if (m.method === "Runtime.consoleAPICalled") consoleMsgs.push((m.params.args || []).map((a) => String(a.value ?? a.description ?? "")).join(" "));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

const order = () => ev(`JSON.stringify([...document.querySelectorAll('[data-testid="pinned-grid"] [data-theme]')].map(e => e.getAttribute('data-theme')))`);
const slotCentre = (i) => ev(`(() => {
  const s = document.querySelector('[data-testid="pinned-slot-${i}"]');
  if (!s) return null;
  const b = s.getBoundingClientRect();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
})()`);
const handleCentre = (i) => ev(`(() => {
  const h = document.querySelector('[data-testid="drag-handle-${i}"]');
  if (!h) return null;
  const b = h.getBoundingClientRect();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
})()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    localStorage.setItem('puzzle_trainer_sync','off');
    if (!localStorage.getItem('__drag_seeded')) {
      localStorage.setItem('__drag_seeded','1');
      localStorage.setItem('puzzle_trainer_pinned_themes', ${JSON.stringify(JSON.stringify(pins))});
      localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: ${realRating} }));
      localStorage.removeItem('puzzle_trainer_quickrun');
    }
  `,
});

// Clear once so the seed re-applies and the run is idempotent.
await send("Page.navigate", { url: "http://localhost:3000/?drag=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?drag=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="tab-training"]')?.click()`);
await sleep(2500);

const before = JSON.parse(await order() ?? "[]");
console.log(`  order before: ${before.slice(0, 4).join(", ")} ...`);
const hc = await handleCentre(0);
const c1 = await slotCentre(1);
console.log(`  handle 0 at ${JSON.stringify(hc)}, target card 1 centre at ${JSON.stringify(c1)}`);
ok(!!hc && !!c1, "found the drag handle on card 0 and the centre of card 1");

// ---- Attempt A: real mouse input through CDP --------------------------------
if (hc && c1) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: hc.x, y: hc.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(200);
  // Several intermediate moves: one jump can be treated as a teleport, and
  // elementFromPoint is only sampled on each move event.
  for (let s = 1; s <= 5; s++) {
    const x = Math.round(hc.x + (c1.x - hc.x) * (s / 5));
    const y = Math.round(hc.y + (c1.y - hc.y) * (s / 5));
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(120);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c1.x, y: c1.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(1800);
}
const afterMouse = JSON.parse(await order() ?? "[]");
const movedByMouse = JSON.stringify(before) !== JSON.stringify(afterMouse);
console.log(`  order after mouse drag: ${afterMouse.slice(0, 4).join(", ")} ...  changed=${movedByMouse}`);
ok(movedByMouse, "a real CDP MOUSE drag reorders the pinned cards");

// ---- Attempt B: real touch input (the app is mobile-first) -------------------
let movedByTouch = false;
if (!movedByMouse) {
  const hc2 = await handleCentre(0);
  const c2 = await slotCentre(1);
  const start = JSON.parse(await order() ?? "[]");
  if (hc2 && c2) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hc2.x, y: hc2.y, id: 1 }] });
    await sleep(200);
    for (let s = 1; s <= 5; s++) {
      const x = Math.round(hc2.x + (c2.x - hc2.x) * (s / 5));
      const y = Math.round(hc2.y + (c2.y - hc2.y) * (s / 5));
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
      await sleep(120);
    }
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(1800);
  }
  const afterTouch = JSON.parse(await order() ?? "[]");
  movedByTouch = JSON.stringify(start) !== JSON.stringify(afterTouch);
  console.log(`  order after touch drag: ${afterTouch.slice(0, 4).join(", ")} ...  changed=${movedByTouch}`);
  ok(movedByTouch, "a real CDP TOUCH drag reorders the pinned cards");
}

const errs = consoleMsgs.filter((m) => /NotFoundError|setPointerCapture|Uncaught/i.test(m));
if (errs.length) {
  console.log("  console complaints:");
  errs.slice(0, 3).forEach((e) => console.log("    !", e.slice(0, 160)));
}

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
