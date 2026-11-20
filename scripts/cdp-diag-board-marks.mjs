/** What are the coloured lines/marks on the board when the solution plays? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
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
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork']))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);

await ev(`(() => { const b=document.querySelector('[data-testid="quickstart-button"]'); b&&b.click(); })()`);
await sleep(9000);

const dump = () => ev(`(() => {
  const out = [];
  // chessground marks squares with <square class="..."> or via cg-board children
  document.querySelectorAll('cg-board > *, .cg-board > *').forEach((el) => {
    const cs = getComputedStyle(el);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: el.getAttribute('class') || '',
      style: el.getAttribute('style') || '',
      bg: cs.backgroundColor,
      boxShadow: cs.boxShadow,
    });
  });
  return out;
})()`);

console.log("=== board marks BEFORE solution ===");
console.log(JSON.stringify((await dump()).slice(0, 6), null, 1));

// Play the opponent's move + reveal solution, then look again.
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
await sleep(4500);

console.log("\n=== board marks AFTER solution is shown ===");
const after = await dump();
console.log(JSON.stringify(after.slice(0, 10), null, 1));

console.log("\n=== any SVG / arrow elements? ===");
console.log(await ev(`(() => {
  const svgs = document.querySelectorAll('svg');
  return [...svgs].map(s => ({ cls: s.getAttribute('class') || '', html: s.outerHTML.slice(0, 200) }));
})()`));

console.log("\n=== class names used on cg-board children ===");
console.log(await ev(`[...new Set([...document.querySelectorAll('cg-board > *')].map(e=>e.getAttribute('class')||'(none)'))].join(' | ')`));
ws.close();
