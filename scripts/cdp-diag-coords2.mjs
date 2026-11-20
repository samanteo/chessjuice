/** Compact: where exactly are the coords relative to the board, and what covers them? */
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

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
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
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(8000);

const r = await ev(`(() => {
  const R = (el) => { if(!el) return null; const b = el.getBoundingClientRect();
    return {x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height)}; };
  const wrap = document.querySelector('.cg-wrap');
  const board = document.querySelector('.cg-wrap cg-board');
  const ranks = document.querySelector('.cg-wrap coords.ranks');
  const files = document.querySelector('.cg-wrap coords.files');
  const firstRank = ranks && ranks.querySelector('coord');
  const lastRank = ranks && [...ranks.querySelectorAll('coord')].pop();
  const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null;
  // Does the board sit ON TOP of the ranks where a number would be?
  const rk = R(firstRank);
  let stack = [];
  if (rk) stack = document.elementsFromPoint(rk.x + 8, rk.y + 8).map(e => e.tagName + '.' + String(e.className).slice(0,20));
  return {
    wrap: R(wrap), board: R(board), ranks: R(ranks), files: R(files),
    ranksZ: cs(ranks,'zIndex'), boardZ: cs(board,'zIndex'),
    ranksPos: cs(ranks,'position'), ranksTop: cs(ranks,'top'), ranksLeft: cs(ranks,'left'),
    ranksOrder: ranks ? [...ranks.querySelectorAll('coord')].map(c=>c.textContent.trim()).join('') : null,
    firstRank: { rect: rk, text: firstRank && firstRank.textContent.trim() },
    lastRank: { rect: R(lastRank), text: lastRank && lastRank.textContent.trim() },
    stackAtFirstNumber: stack,
    coordsInsideBoard: (() => {
      const wb = R(wrap);
      const check = (b) => b && b.x >= wb.x-2 && b.x <= wb.x+wb.w && b.y >= wb.y-2 && b.y <= wb.y+wb.h;
      return { ranksInside: check(R(ranks)), filesInside: check(R(files)) };
    })(),
  };
})()`);
console.log(JSON.stringify(r, null, 1));
ws.close();
