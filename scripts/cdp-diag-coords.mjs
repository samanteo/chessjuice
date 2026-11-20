/** Why are the rank NUMBERS invisible while the file LETTERS show? */
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

const info = await ev(`(() => {
  const wrap = document.querySelector('.cg-wrap');
  if (!wrap) return { error: 'no .cg-wrap' };
  const q = (sel) => document.querySelector(sel);
  const describe = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      text: (el.innerText || el.textContent || '').trim(),
      cls: el.className,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      color: cs.color,
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
      fontSize: cs.fontSize,
      zIndex: cs.zIndex,
      position: cs.position,
      overflow: cs.overflow,
    };
  };
  const ranksEl = q('.cg-wrap coords.ranks');
  const filesEl = q('.cg-wrap coords.files');
  const wrapRect = wrap.getBoundingClientRect();
  return {
    wrap: { x: Math.round(wrapRect.x), y: Math.round(wrapRect.y), w: Math.round(wrapRect.width), h: Math.round(wrapRect.height) },
    ranksEl: describe(ranksEl),
    filesEl: describe(filesEl),
    rankCoords: ranksEl ? [...ranksEl.querySelectorAll('coord')].map(c => {
      const cs = getComputedStyle(c); const r = c.getBoundingClientRect();
      return { t: c.textContent.trim(), cls: c.className, color: cs.color,
               rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
               vis: cs.visibility, disp: cs.display, op: cs.opacity };
    }) : null,
    fileCoords: filesEl ? [...filesEl.querySelectorAll('coord')].slice(0,3).map(c => {
      const cs = getComputedStyle(c);
      return { t: c.textContent.trim(), color: cs.color, op: cs.opacity };
    }) : null,
    // Is something painted OVER the left column?
    leftEdgeStack: (() => {
      const x = Math.round(wrapRect.x + 6), y = Math.round(wrapRect.y + 6);
      const els = document.elementsFromPoint(x, y);
      return els.slice(0, 6).map(e => e.tagName + '.' + String(e.className).slice(0, 28));
    })(),
  };
})()`);
console.log(JSON.stringify(info, null, 1));
ws.close();
