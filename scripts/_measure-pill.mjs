/** Measure the header pill in BOTH states: does it stay put? */
import { WebSocket } from "ws";
const targets = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const page = targets.find((t) => t.type === "page");
const sock = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
const send = (() => {
  let id = 0;
  const pend = new Map();
  sock.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  return (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
})();
await new Promise((r) => sock.on("open", r));
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(4000);
const geo = () => ev(`(() => {
  const pill = document.querySelector('[data-testid="header-progress"]');
  const gear = [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === '⚙️');
  const title = document.querySelector('[data-testid="home-logo"]');
  const p = pill.getBoundingClientRect(), g = gear.getBoundingClientRect(), t = title.getBoundingClientRect();
  return JSON.stringify({ state: pill.getAttribute('data-on'), label: pill.innerText.trim(),
    pill: { left: Math.round(p.left), right: Math.round(p.right), w: Math.round(p.width) },
    gapTitle: Math.round(p.left - t.right), gapCog: Math.round(g.left - p.right) });
})()`);
console.log("ON :", await geo());
await ev(`document.querySelector('[data-testid="header-progress"]').click()`);
await sleep(700);
console.log("OFF:", await geo());
await ev(`document.querySelector('[data-testid="header-progress"]').click()`);
await sleep(500);
sock.close();
