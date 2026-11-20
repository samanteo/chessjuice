/** What does the Training tab actually show as "selected"? */
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
await sleep(14000);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

console.log("=== TRAINING TAB (fresh, nothing ever pinned) ===");
console.log("pinned in storage:", await ev(`localStorage.getItem('puzzle_trainer_pinned_themes')`));
console.log("\nvisible text:");
console.log(await ev(`(() => {
  const main = document.querySelector('main') || document.body;
  return (main.innerText||"").replace(/\\n{2,}/g,"\\n").slice(0, 900);
})()`));

console.log("\n=== controls on the Training tab ===");
const ctrls = await ev(`(() => [...document.querySelectorAll('button,select,input')].map(e => ({
  tag: e.tagName, t: (e.innerText||e.placeholder||"") .replace(/\\s+/g," ").trim().slice(0,40),
  checked: e.checked === undefined ? undefined : e.checked,
  value: e.tagName === "SELECT" ? e.value : undefined,
})).filter(x=>x.t))()`);
ctrls.forEach(c => console.log("  ", JSON.stringify(c)));

console.log("\n=== does any 'All themes' chip/option look selected? ===");
console.log(await ev(`(() => {
  const hits = [...document.querySelectorAll('button,option,span,div')].filter(e => /^All themes$/i.test((e.innerText||"").trim()));
  return hits.map(e => ({
    tag: e.tagName,
    cls: (e.className||"").toString().slice(0,80),
    selected: e.getAttribute('aria-selected') || e.getAttribute('data-state') || null,
  }));
})()`));
ws.close();
