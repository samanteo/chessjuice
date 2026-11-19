/** Enumerate every clickable thing on the All themes page. */
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
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(4000);

const dump = await ev(`(() => {
  const out = [];
  document.querySelectorAll('button').forEach((b, i) => {
    const t = (b.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 58);
    if (!t) return;
    out.push({
      i,
      t,
      dis: b.disabled,
      hasOnClick: !!b.onclick,
      cls: (b.className || "").slice(0, 40),
    });
  });
  return { total: out.length, buttons: out };
})()`);
console.log("total buttons:", dump.total);
dump.buttons.slice(0, 45).forEach(b => console.log(`  [${b.i}]${b.dis ? " DISABLED" : ""} "${b.t}"`));

console.log("\n=== headings / accordion text ===");
const heads = await ev(`(() => [...document.querySelectorAll('h1,h2,h3,h4,summary')].map(e => (e.innerText||"").replace(/\\s+/g," ").trim().slice(0,60)).filter(Boolean))()`);
console.log(JSON.stringify(heads, null, 1));
ws.close();
