/** Type "jobava" on All themes and dump what the openings section actually shows. */
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
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3500);

console.log("=== before typing: openings section text ===");
console.log(await ev(`(() => {
  const h = [...document.querySelectorAll('h2,h3')].find(e=>/openings/i.test(e.innerText||""));
  const sec = h ? h.closest('section,div') : null;
  return (sec ? sec.innerText : "no openings section").replace(/\\s+/g," ").slice(0, 300);
})()`));

const typed = await ev(`(() => {
  const i = document.querySelector('input[placeholder*="Search themes"]');
  if (!i) return "NO INPUT";
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(i, "jobava");
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return i.value;
})()`);
console.log("typed:", typed);
await sleep(3000);

console.log("\n=== after typing 'jobava' ===");
const after = await ev(`(() => ({
  openingsSection: (() => {
    const h = [...document.querySelectorAll('h2,h3')].find(e=>/openings/i.test(e.innerText||""));
    const sec = h ? h.closest('section,div') : null;
    return sec ? sec.innerText.replace(/\\s+/g," ").slice(0, 400) : "gone";
  })(),
  allJobava: [...document.querySelectorAll('*')].filter(e=>e.children.length===0 && /jobava/i.test(e.innerText||"")).map(e=>e.innerText.trim()).slice(0,8),
  anyButtonJobava: [...document.querySelectorAll('button')].filter(b=>/jobava/i.test(b.innerText||"")).length,
}))()`);
console.log(JSON.stringify(after, null, 1));
ws.close();
