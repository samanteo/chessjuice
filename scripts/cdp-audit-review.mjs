/**
 * Audit the Review tab: what does it render, what's in each queue, any overflow?
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);

// Seed mistakes at rung 0 (due now) so the queues are populated.
const picked = [];
{
  const res = await fetch("http://localhost:3000/api/puzzles?themes=fork&limit=100");
  const rows = await res.json();
  for (const r of rows.slice(0, 5)) picked.push({ id: r.id, rating: r.rating, themes: r.themes });
}
const now = Date.now();
const progress = {};
picked.forEach((pp, i) => {
  progress[pp.id] = {
    rg: i < 3 ? 0 : 2,
    wr: 1,
    at: 1, co: 0,
    due: new Date(now + (i < 3 ? -60000 : 86400000 * 3)).toISOString(),
    lr: new Date(now - 3600000).toISOString(),
    iw: 1,
  };
});
await evalJs(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(progress))})`);
await evalJs(`localStorage.removeItem('puzzle_trainer_attempts')`);
events.length = 0;
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(5000);

const d = await evalJs(`(() => {
  const main = document.querySelector('main');
  const txt = main.innerText;
  const bad = [...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+8&&e.clientWidth>60);
  return {
    text: txt.slice(0, 1200),
    queueTabs: [...document.querySelectorAll('[role="tab"],[data-queue]')].map(e=>e.innerText.replace(/\\n/g,' ').trim()).slice(0,8),
    buttons: [...main.querySelectorAll('button')].map(b=>b.innerText.replace(/\\n/g,' ').trim()).filter(Boolean).slice(0,20),
    rows: main.querySelectorAll('li').length,
    overflowCount: bad.length,
    overflow: bad.slice(0,4).map(e=>({ tid:e.getAttribute('data-testid')||'', sw:e.scrollWidth, cw:e.clientWidth, txt:(e.innerText||'').replace(/\\n/g,' ').slice(0,40) })),
    apiCalls: [],
  };
})()`);
console.log("=== REVIEW TAB TEXT ===");
console.log(d.text);
console.log("\n=== queue tabs ===", JSON.stringify(d.queueTabs));
console.log("=== buttons ===", JSON.stringify(d.buttons));
console.log("=== rows ===", d.rows, " overflow:", d.overflowCount, JSON.stringify(d.overflow));
const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
console.log("=== exceptions ===", errs.length);
errs.slice(0,3).forEach(e => console.log("  !", (e.params.exceptionDetails.exception?.description ?? "").slice(0,200)));
ws.close();
process.exit(0);
