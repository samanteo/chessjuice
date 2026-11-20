/** Audit: animation enabled? sound present? opponent first move animated? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
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
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

events.length = 0;
await ev(`(() => { const b=[...document.querySelectorAll('main button')].find(x=>/Random Puzzle/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(8000);

const audit = await ev(`(() => {
  const wrap = document.querySelector('.cg-wrap');
  const board = document.querySelector('cg-board');
  const settings = JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}');
  const prefs = JSON.parse(localStorage.getItem('puzzle_trainer_theme_prefs')||'{}');
  return {
    dataAnim: board?.dataset?.anim ?? null,
    dataHlLast: board?.dataset?.hlLast ?? null,
    boardClasses: (board?.className||'') + ' | ' + (wrap?.className||''),
    settingsAnimKeys: Object.keys(settings).filter(k=>/anim|sound|mute|volume/i.test(k)),
    prefsAnimKeys: Object.keys(prefs).filter(k=>/anim|sound|mute|volume/i.test(k)),
    prefsAll: Object.keys(prefs),
    settingsAll: Object.keys(settings),
    audioElements: document.querySelectorAll('audio').length,
    pieceTransitions: (() => {
      const el = document.querySelector('piece');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { transition: cs.transition, transform: cs.transform };
    })(),
    lastMoveHighlights: document.querySelectorAll('square.last-move').length,
  };
})()`);
console.log("AUDIT:", JSON.stringify(audit, null, 1));

// Was any audio requested during load/play?
const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
const audioReqs = reqs.filter(u => /\.(mp3|wav|ogg|m4a)/i.test(u));
console.log("audio network requests:", audioReqs.length);

// Is there any sound-related API used?
const soundApi = await ev(`(() => {
  const out = [];
  if (window.Audio) out.push('Audio ctor available');
  if (window.AudioContext || window.webkitAudioContext) out.push('AudioContext available');
  return out;
})()`);
console.log("audio APIs available:", JSON.stringify(soundApi));
ws.close();
process.exit(0);
