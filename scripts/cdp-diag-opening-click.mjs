/** Click an OPENING card on All themes and see whether anything happens. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const reqs = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") {
    const u = m.params?.request?.url ?? "";
    if (/\/api\/(dispense|puzzles)/.test(u)) reqs.push(u.replace("http://localhost:3000",""));
  }
});
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
await sleep(14000);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3500);

// How many puzzles does the client actually hold in memory?
const mem = await ev(`(() => {
  const keys = Object.keys(localStorage);
  return { storageKeys: keys.length, userPuzzles: (localStorage.getItem('puzzle_trainer_user_puzzles')||'').length };
})()`);
console.log("client memory:", JSON.stringify(mem));

// Expand the Openings section, then click its first card.
await ev(`document.querySelector('[data-testid="openings-toggle"]')?.click()`);
await sleep(2500);
const cards = await ev(`(() => {
  const list = document.querySelector('[data-testid="openings-list"]');
  if (!list) return { found: false };
  const btns = [...list.querySelectorAll('button')];
  return { found: true, n: btns.length, first: btns.slice(0,3).map(b=>(b.innerText||"").replace(/\\s+/g," ").slice(0,45)) };
})()`);
console.log("opening cards:", JSON.stringify(cards));

for (let i = 0; i < 3; i++) {
  reqs.length = 0;
  const before = await ev(`!!document.querySelector('cg-board')`);
  const clicked = await ev(`(() => {
    const list = document.querySelector('[data-testid="openings-list"]');
    const btns = [...list.querySelectorAll('button')];
    const b = btns[${i}];
    if (!b) return null;
    const t = (b.innerText||"").replace(/\\s+/g," ").slice(0,40);
    b.click();
    return t;
  })()`);
  await sleep(7000);
  const after = await ev(`(() => ({
    board: !!document.querySelector('cg-board'),
    label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  }))()`);
  console.log(`\n[${i}] clicked "${clicked}"`);
  console.log(`    boardBefore=${before} boardAfter=${after.board} label=${JSON.stringify(after.label)}`);
  console.log(`    requests: ${JSON.stringify(reqs)}`);
}
ws.close();
