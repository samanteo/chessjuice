/** Why can't you click a theme on All themes, and why is the served puzzle random? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);

// 1. Where are the theme rows? Are they behind a collapsed accordion?
const where = await ev(`(() => {
  const rows = [...document.querySelectorAll('button')].filter(b => /Play →/.test(b.innerText));
  const disabled = rows.filter(b => b.disabled);
  return {
    visibleThemeRows: rows.length,
    disabledRows: disabled.length,
    sample: rows.slice(0,5).map(b => ({ t: (b.innerText||"").split("\\n")[0], dis: b.disabled })),
  };
})()`);
console.log("theme rows on arrival:", JSON.stringify(where, null, 1));

// 2. Is the network request even carrying the theme?
const reqs = [];
await send("Network.enable");
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.method === "Network.requestWillBeSent" && /\/api\/dispense/.test(m.params?.request?.url ?? "")) reqs.push(m.params.request.url); });

// expand the first category, then click its first theme
const expanded = await ev(`(() => {
  const hdr = [...document.querySelectorAll('button')].find(b => /puzzles/.test(b.innerText) && !/Play →/.test(b.innerText));
  if (hdr) { hdr.click(); return hdr.innerText.split("\\n")[0]; }
  return null;
})()`);
console.log("expanded category:", expanded);
await sleep(1500);

const clicked = await ev(`(() => {
  const row = [...document.querySelectorAll('button')].find(b => /Play →/.test(b.innerText));
  if (!row) return null;
  const name = (row.innerText||"").split("\\n")[0];
  row.click();
  return name;
})()`);
console.log("clicked theme row:", clicked);
await sleep(8000);

const shown = await ev(`(() => ({
  label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  board: !!document.querySelector('cg-board'),
}))()`);
console.log("board shows theme:", JSON.stringify(shown));
console.log("dispense requests:", JSON.stringify(reqs));

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
console.log("exceptions:", errs.length);
errs.slice(0,3).forEach(e=>console.log("  !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));
ws.close();
