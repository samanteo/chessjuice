/** Click a piece by its own DOM rect, not by arithmetic. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ method: m, id: i, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};
const pieces = await ev(`(() => {
  const b = document.querySelector('cg-board').getBoundingClientRect();
  const s = b.width / 8;
  return [...document.querySelectorAll('cg-board piece')].map(p => {
    const r = p.getBoundingClientRect();
    const col = Math.round((r.x + r.width/2 - b.x) / s), row = Math.round((r.y + r.height/2 - b.y) / s);
    return { cls: p.className, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), col, row };
  });
})()`);
console.log("pieces:", pieces.length, JSON.stringify(pieces.slice(0, 6)));
const q = pieces.find(p => p.cls.includes('queen'));
console.log("queen at", q && { x: q.x, y: q.y, cls: q.cls });
if (q) {
  await click(q.x, q.y);
  await sleep(900);
  console.log("selected:", await ev(`document.querySelectorAll('cg-board square.selected').length`),
    "markers:", await ev(`document.querySelectorAll('cg-board square.move-dest').length`));
}
ws.close();
