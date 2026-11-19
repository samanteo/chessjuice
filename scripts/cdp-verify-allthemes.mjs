/** Verify the All-themes tab renders SERVER counts (6.19M catalogue, not the subset). */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(6000);
// The openings list is collapsed by default — expand it before counting rows.
await evalJs(`(() => { const t=document.querySelector('[data-testid="openings-toggle"]'); t&&t.click(); })()`);
await sleep(1500);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const d = await evalJs(`(() => {
  const main = document.querySelector('main');
  const txt = main.innerText;
  const counts = [...txt.matchAll(/([\\d,]{4,})\\s+puzzles/g)].map(m => m[1]);
  return {
    totalLine: txt.match(/[\\d,]+ puzzles · [\\d,]+ openings/)?.[0] ?? null,
    bigCounts: counts.slice(0,6),
    maxCount: counts.map(c => Number(c.replace(/,/g,''))).sort((a,b)=>b-a)[0] ?? 0,
    openingsSection: !!document.querySelector('[data-testid="openings-section"]'),
    openingRows: document.querySelectorAll('[data-testid="openings-list"] > *').length,
    text: txt.slice(0, 600),
  };
})()`);
console.log(JSON.stringify(d, null, 1));
ok(d.bigCounts.length > 0, `theme cards show counts (${d.bigCounts.join(", ")})`);
ok(d.maxCount > 100000, `counts are CATALOGUE-scale, not the local subset (max ${d.maxCount.toLocaleString()})`);
ok(d.openingsSection, "openings section present");
ok(d.openingRows > 0, `opening rows render (${d.openingRows})`);

console.log(`\n  PASS ${pass}   FAIL ${fail}`);
ws.close();
process.exit(fail ? 1 : 0);
