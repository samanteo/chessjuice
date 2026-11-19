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
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// Clean slate on both sides.
await fetch("http://localhost:3000/api/state", { method: "DELETE" }).catch(() => {});
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork']))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);

// ---- 1. Train a puzzle and FAIL it, so it becomes a due mistake ----
const started = await clickBtn(`/Quick start/i`);
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
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
  const sol = [...document.querySelectorAll('button')].find(b=>/^Solution$/i.test(b.innerText.trim()));
  const skip = document.querySelector('[data-testid="next-button"]') || document.querySelector('[data-testid="skip-button"]');
  const cs = strip ? getComputedStyle(strip) : null;
  return { boardUp: !!document.querySelector('[data-board-context="training"]'),
           sol: r(sol), skip: r(skip), strip: r(strip), stripBg: cs ? cs.backgroundColor : null };
})()`);
console.log("training foot:", JSON.stringify(t));
ok(t.strip !== null, "session strip renders inside the TRAINING board foot");
ok(t.strip && t.sol && t.skip && t.strip.x > t.sol.x && t.strip.x < t.skip.x,
   `strip sits BETWEEN Solution and Skip (sol x=${t.sol?.x} < strip x=${t.strip?.x} < skip x=${t.skip?.x})`);
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
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
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
