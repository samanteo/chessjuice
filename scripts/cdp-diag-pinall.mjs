/** Does "Pin all shown" explain "the training tab has all themes selected"? */
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
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

// Open the picker from Training
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Add theme/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);

const before = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x=>/Pin all shown/i.test(x.innerText));
  const each = [...document.querySelectorAll('button')].filter(x=>/Pin |Pinned/.test(x.innerText)).length;
  return { pinAllLabel: b?.innerText ?? null, individualPinControls: each,
           pinnedNow: JSON.parse(localStorage.getItem('puzzle_trainer_pinned_themes')||'[]').length };
})()`);
console.log("BEFORE:", JSON.stringify(before));

// Click "Pin all shown"
const clicked = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x=>/Pin all shown/i.test(x.innerText));
  if (!b) return null;
  b.click(); return b.innerText;
})()`);
console.log("clicked:", clicked);
await sleep(2500);

const after = await ev(`(() => {
  const pins = JSON.parse(localStorage.getItem('puzzle_trainer_pinned_themes')||'[]');
  return { pinnedCount: pins.length, sample: pins.slice(0,8) };
})()`);
console.log("AFTER pin-all:", JSON.stringify(after));

// Close the picker and look at the Training tab grid
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Close|Done|✕/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2500);
const training = await ev(`(() => {
  const main = document.querySelector('main') || document.body;
  const txt = (main.innerText||"");
  return {
    hasPinEmptyState: /Pin your daily themes here/.test(txt),
    quickStartLabel: document.querySelector('[data-testid="quickstart-button"]')?.innerText ?? null,
    tileCount: [...document.querySelectorAll('button')].filter(b=>/puzzles/.test(b.innerText)||/^[^\\n]+\\n\\d/.test(b.innerText)).length,
    excerpt: txt.replace(/\\s+/g," ").slice(0, 260),
  };
})()`);
console.log("\nTRAINING TAB AFTER PIN-ALL:");
console.log(JSON.stringify(training, null, 1));
ws.close();
