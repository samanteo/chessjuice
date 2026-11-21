/** What is actually at the click point, and what is above the board? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ method: m, id: i, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
console.log(JSON.stringify(await ev(`(() => {
  const b = document.querySelector('cg-board');
  const r = b.getBoundingClientRect();
  const wrap = document.querySelector('.cg-wrap');
  const at = document.elementFromPoint(200, r.y + 100);
  const head = document.querySelector('.board-panel__head')?.getBoundingClientRect();
  const panel = document.querySelector('.board-panel')?.getBoundingClientRect();
  return {
    orient: wrap?.className,
    board: { y: r.y, h: r.height, w: r.width },
    head: head && { y: head.y, h: head.height },
    panel: panel && { y: panel.y, h: panel.height },
    atPoint: at && { tag: at.tagName, cls: at.className, testid: at.getAttribute?.('data-testid') },
    bar: document.querySelector('[data-testid="global-bar"]')?.getBoundingClientRect?.().y ?? null,
    globalBar: document.querySelector('.pixel-bar')?.getBoundingClientRect().y ?? null,
    row: document.querySelector('[data-testid="quickrun-status"]')?.getBoundingClientRect?.().y ?? null,
    scrollY: window.scrollY,
  };
})()`), null, 1));
ws.close();
