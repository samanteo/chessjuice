/** Clean probe: start a puzzle, read the ACTUAL board FEN, click the solver's move. */
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
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(4000);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork','pin']));`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(4000);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(5000);
const st = await ev(`(() => {
  const stage = document.querySelector('[data-testid="board-stage"]');
  const b = document.querySelector('cg-board'); const r = b.getBoundingClientRect();
  const w = b.closest('.cg-wrap');
  return { fen: stage?.getAttribute('data-fen'), x: r.x, y: r.y, w: r.width, h: r.height,
    orient: (w?.className||'').includes('black') ? 'black' : 'white',
    title: document.querySelector('.board-panel__title')?.innerText?.slice(0,40) ?? null,
    dot: document.querySelector('[data-testid="solver-color-dot"]')?.dataset.color ?? null };
})()`);
console.log("state:", JSON.stringify(st, null, 1));
const pid = (st.title || "").match(/Puzzle #([A-Za-z0-9]{5})/)?.[1];
const p = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid}`)).json();
const mv = (p.moves || "").split(" ").filter(Boolean);
console.log("pid", pid, "moves", mv.slice(0,4).join(" "), "fen", p.fen);
const from = mv[1].slice(0, 2);
const f = from.charCodeAt(0) - 97, rk = Number(from[1]), s = st.w / 8;
const x = st.x + (st.orient === 'black' ? 7 - f : f) * s + s / 2;
const y = st.y + (st.orient === 'black' ? rk - 1 : 8 - rk) * s + s / 2;
console.log("click", from, "at", Math.round(x), Math.round(y), "board", st.x, st.y, st.w, st.orient);
await click(x, y);
await sleep(900);
console.log("selected:", await ev(`document.querySelectorAll('cg-board square.selected').length`),
  "markers:", await ev(`document.querySelectorAll('cg-board square.move-dest').length`),
  "dests:", await ev(`document.querySelector('.cg-wrap')?.getAttribute('data-dests')`));
ws.close();
