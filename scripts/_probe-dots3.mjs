/** Click the solver's first move square with orientation handling; report state. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ method: m, id: i, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};
const geo = () => ev(`(() => { const b = document.querySelector('cg-board'); const r = b.getBoundingClientRect(); const w = b.closest('.cg-wrap'); return { x: r.x, y: r.y, w: r.width, orient: (w?.className||'').includes('black') ? 'black' : 'white', cls: w?.className }; })()`);
const xy = (g, sq) => { const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]), s = g.w / 8;
  return { x: g.x + (g.orient === 'black' ? 7 - f : f) * s + s / 2, y: g.y + (g.orient === 'black' ? rk - 1 : 8 - rk) * s + s / 2 }; };
const g = await geo();
console.log("geo:", JSON.stringify(g));
const title = await ev(`document.querySelector('.board-panel__title')?.innerText ?? ''`);
const pid = (title.match(/Puzzle #([A-Za-z0-9]{5})/) || [])[1];
const p = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid}`)).json();
const mv = (p.moves || "").split(" ").filter(Boolean);
console.log("pid", pid, "moves", mv.slice(0, 3).join(" "), "fen", p.fen);
const from = mv[1].slice(0, 2);
const pt = xy(g, from);
console.log("click", from, "at", Math.round(pt.x), Math.round(pt.y));
console.log("elementFromPoint:", await ev(`(() => { const e = document.elementFromPoint(${Math.round(pt.x)}, ${Math.round(pt.y)}); return e ? e.tagName + '.' + e.className : null })()`));
await click(pt.x, pt.y);
await sleep(900);
console.log("selected:", await ev(`document.querySelectorAll('cg-board square.selected').length`),
  "markers:", await ev(`document.querySelectorAll('cg-board square.move-dest').length`),
  "dests attr:", await ev(`document.querySelector('.cg-wrap')?.getAttribute('data-dests')`),
  "pieces:", await ev(`document.querySelectorAll('cg-board piece').length`));
ws.close();
