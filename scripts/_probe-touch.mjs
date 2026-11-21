/** Try touch vs mouse events on the board. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 23 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
const dot = await ev(`document.querySelector('[data-testid="solver-color-dot"]')?.dataset.color ?? null`);
const piece = await ev(`(() => {
  const b = document.querySelector('cg-board').getBoundingClientRect();
  const p = [...document.querySelectorAll('cg-board piece')].find(pp => pp.className.startsWith('${"white"}'));
  const r = p.getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), cls: p.className };
})()`);
console.log("target piece", JSON.stringify(piece), "dot", dot);
const state = async (label) => {
  const sel = await ev(`document.querySelectorAll('cg-board square.selected').length`);
  const mk = await ev(`document.querySelectorAll('cg-board square.move-dest').length`);
  console.log(`${label}: selected ${sel}, markers ${mk}`);
};
// touch
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: piece.x, y: piece.y }] });
await sleep(80);
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(700);
await state("after touch");
// mouse with pointerType
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: piece.x, y: piece.y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
await sleep(80);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: piece.x, y: piece.y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
await sleep(700);
await state("after mouse");
console.log("touch enabled:", await ev(`'ontouchstart' in window`), "pointer events:", await ev(`window.PointerEvent ? 'yes' : 'no'`));
ws.close();
