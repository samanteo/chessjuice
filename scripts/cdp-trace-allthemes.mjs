/** Click ONE named theme on All themes and trace exactly what is requested. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const reqs = []; const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") {
    const u = m.params?.request?.url ?? "";
    if (/\/api\/(dispense|puzzles)/.test(u)) reqs.push(u.replace("http://localhost:3000", ""));
  } else if (m.method) events.push(m);
});
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
await sleep(4000);

for (const want of ["Fork", "Mate in 1", "Pin"]) {
  reqs.length = 0;
  const clicked = await ev(`(() => {
    const row = [...document.querySelectorAll('button')].find(b => {
      const t = (b.innerText || "");
      return t.includes(${JSON.stringify(want)}) && b.querySelector('h4');
    });
    if (!row) return null;
    row.click();
    return (row.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 40);
  })()`);
  await sleep(7000);
  const shown = await ev(`(() => ({
    label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
    board: !!document.querySelector('cg-board'),
    rating: document.querySelector('[data-testid="move-counter"]') ? "counter-ok" : "no-counter",
  }))()`);
  console.log(`clicked "${want}" -> row="${clicked}"`);
  console.log(`   board label: ${JSON.stringify(shown.label)}  board:${shown.board}`);
  console.log(`   requests: ${JSON.stringify(reqs.slice(0, 3))}`);
}

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
console.log("\nexceptions:", errs.length);
errs.slice(0,3).forEach(e=>console.log("  !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));
ws.close();
