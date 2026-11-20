/** Why don't the individual openings show in the Add-theme picker? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
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
await sleep(15000);

await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Add theme/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);

const d = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const cat = dlg.querySelector('select');
  return {
    categoryOptions: cat ? [...cat.options].map(o => o.value + ' :: ' + o.text) : null,
    categoryValue: cat?.value ?? null,
    themeRows: dlg.querySelectorAll('[data-testid^="picker-row-"]').length,
    openingRows: dlg.querySelectorAll('[data-testid^="picker-opening-"]').length,
    headings: [...dlg.querySelectorAll('div,h3,h4')].map(e=>e.innerText).filter(t=>/^(Openings|Themes)$/i.test(t||'')).slice(0,4),
    text: dlg.innerText.slice(0, 500),
  };
})()`);
console.log(JSON.stringify(d, null, 1));

// Now switch the category to Openings and recount.
await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const cat = dlg.querySelector('select');
  if (!cat) return;
  cat.value = '__openings__';
  cat.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(2000);
const d2 = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  return {
    themeRows: dlg.querySelectorAll('[data-testid^="picker-row-"]').length,
    openingRows: dlg.querySelectorAll('[data-testid^="picker-opening-"]').length,
    firstOpenings: [...dlg.querySelectorAll('[data-testid^="picker-opening-"]')].slice(0,5).map(e=>e.getAttribute('data-testid')),
    text: dlg.innerText.slice(0, 400),
  };
})()`);
console.log("after selecting Openings category:", JSON.stringify(d2, null, 1));
ws.close();
process.exit(0);
