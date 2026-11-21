/** Does clicking a piece actually draw dots? Try each piece until one selects. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 23 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};
const title = await ev(`document.querySelector('.board-panel__title')?.innerText ?? ''`);
const pid = (title.match(/Puzzle #([A-Za-z0-9]+)/) || [])[1];
const p = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid}`)).json();
const mv = p.moves.split(" ");
console.log("puzzle", pid, "turn", p.fen.split(" ")[1], "moves", mv.slice(0, 3).join(" "));
const dot = await ev(`document.querySelector('[data-testid="solver-color-dot"]')?.dataset.color ?? null`);
console.log("solver colour dot:", dot);
const list2 = await ev(`(() => {
  const b = document.querySelector('cg-board').getBoundingClientRect();
  return [...document.querySelectorAll('cg-board piece')].map(pp => {
    const r = pp.getBoundingClientRect();
    return { cls: pp.className, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  });
})()`);
const mine = list2.filter((x) => x.cls.startsWith(dot === "black" ? "black" : "white"));
console.log("my pieces:", mine.length);
for (const pc of mine.slice(0, 3)) {
  await click(pc.x, pc.y);
  await sleep(600);
  const m = await ev(`document.querySelectorAll('cg-board square.move-dest').length`);
  const sel = await ev(`document.querySelectorAll('cg-board square.selected').length`);
  console.log(`clicked ${pc.cls} at ${pc.x},${pc.y} -> selected ${sel}, markers ${m}`);
  if (m > 0) break;
}
ws.close();
