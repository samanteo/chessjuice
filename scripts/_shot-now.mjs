/** Screenshot whatever is on the test browser right now + board geometry. */
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const ws2 = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 23 });
await new Promise((r) => ws2.once("open", r));
let id = 0; const pend = new Map();
ws2.onmessage = (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws2.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
console.log(await ev(`(() => {
  const b = document.querySelector('cg-board').getBoundingClientRect();
  const st = document.querySelector('[data-testid="board-stage"]').getBoundingClientRect();
  const wrap = document.querySelector('.cg-wrap').getBoundingClientRect();
  return JSON.stringify({ board: {x:b.x,y:b.y,w:b.width,h:b.height}, stage: {x:st.x,y:st.y,w:st.width,h:st.height}, wrap: {x:wrap.x,y:wrap.y,w:wrap.width,h:wrap.height}, vw: innerWidth, vh: innerHeight, scrollY });
})()`));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/now.png", Buffer.from(shot.result.data, "base64"));
console.log("shot /tmp/now.png");
ws2.close();
