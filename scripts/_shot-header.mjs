/** Capture just the header band so the pill's spacing can be judged. */
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";
const targets = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const page = targets.find((t) => t.type === "page");
const sock = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
const send = (() => {
  let id = 0;
  const pend = new Map();
  sock.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); }
  });
  return (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
})();
await new Promise((res) => sock.on("open", res));
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/" });
await new Promise((res) => setTimeout(res, 4000));
const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80, clip: { x: 0, y: 0, width: 390, height: 120, scale: 2 } });
writeFileSync("/tmp/header-band.jpg", Buffer.from(shot.result.data, "base64"));
const geo = await send("Runtime.evaluate", {
  expression: `(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => el ? { x: Math.round(el.getBoundingClientRect().left), w: Math.round(el.getBoundingClientRect().width) } : null;
    const title = q('[data-testid="home-logo"]');
    const pill = q('[data-testid="header-progress"]');
    const gear = [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === '⚙️');
    return JSON.stringify({ title: box(title), pill: box(pill), gear: box(gear),
      gapTitlePill: title && pill ? Math.round(pill.getBoundingClientRect().left - title.getBoundingClientRect().right) : null,
      gapPillGear: pill && gear ? Math.round(gear.getBoundingClientRect().left - pill.getBoundingClientRect().right) : null });
  })()`,
  returnByValue: true,
});
console.log(geo.result.result.value);
sock.close();
