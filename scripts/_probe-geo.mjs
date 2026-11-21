/** Is the board's DOM size in step with the piece positions chessground laid out? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 23 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(4000);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork','pin']));`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(4000);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(5000);
console.log(await ev(`(() => {
  const b = document.querySelector('cg-board');
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  const st = document.querySelector('[data-testid="board-stage"]').getBoundingClientRect();
  const pieces = [...document.querySelectorAll('cg-board piece')].slice(0,3).map(p => {
    const pr = p.getBoundingClientRect();
    return { cls: p.className, tx: getComputedStyle(p).transform, x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width) };
  });
  return JSON.stringify({ rect: {x:r.x,y:r.y,w:r.width,h:r.height}, cssW: cs.width, cssH: cs.height, stage: {x:st.x,y:st.y,w:st.width,h:st.height}, fen: document.querySelector('[data-testid="board-stage"]').getAttribute('data-fen'), pieces }, null, 1);
})()`));
ws.close();
