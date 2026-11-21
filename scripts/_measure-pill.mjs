/** Header spacing: title end, pill box, cog box, screen edge. */
import { WebSocket } from "ws";
const targets = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const t = targets.find((x) => x.type === "page");
const sock = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => (sock.onmessage = r));
const send = (method, params) => new Promise((res) => {
  const id = Math.floor(Math.random() * 1e6);
  const h = (raw) => { const m = JSON.parse(raw.data); if (m.id === id) { sock.removeEventListener("message", h); res(m.result); } };
  sock.addEventListener("message", h);
  sock.send(JSON.stringify({ id, method, params }));
});
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await new Promise((r) => setTimeout(r, 4200));
const r = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
  const pill = document.querySelector('[data-testid="header-progress"]');
  const title = document.querySelector('h1');
  const cog = document.querySelector('header button[aria-label], header [data-testid="settings"], header button:last-of-type');
  const pb = pill.getBoundingClientRect(), tb = title.getBoundingClientRect(), cb = cog.getBoundingClientRect();
  return JSON.stringify({ vw: innerWidth, titleEnd: Math.round(tb.right), pill: [Math.round(pb.left), Math.round(pb.right)],
    cog: [Math.round(cb.left), Math.round(cb.right)], gapTitlePill: Math.round(pb.left - tb.right),
    gapPillCog: Math.round(cb.left - pb.right), gapCogEdge: Math.round(innerWidth - cb.right) });
})()` });
console.log(r.result.value);
sock.close();
