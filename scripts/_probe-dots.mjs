/** Why did the dots regression test stop finding markers? */
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
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(3500);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]));`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(4500);
console.log("blocks key:", await ev(`localStorage.getItem('puzzle_trainer_blocks')`));
console.log("button:", await ev(`(() => { const b=document.querySelector('[data-testid="quickstart-button"]'); return b ? {label:b.innerText, disabled:b.disabled} : null })()`));
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(4500);
const info = await ev(`(() => {
  const b = document.querySelector('cg-board');
  const r = b ? b.getBoundingClientRect() : null;
  return {
    board: !!b, rect: r && { x: r.x, y: r.y, w: r.width, h: r.height },
    scrollY: window.scrollY, innerH: window.innerHeight,
    dots: document.querySelectorAll('cg-board square.move-dest').length,
    title: document.querySelector('.board-panel__title')?.innerText?.slice(0,40) ?? null,
    dotsToggle: !!document.querySelector('[data-testid="dots-toggle"]'),
  };
})()`);
console.log("board info:", JSON.stringify(info, null, 1));
if (info.board) {
  const pid = (info.title || "").match(/Puzzle #([A-Za-z0-9]{5})/)?.[1];
  const p = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid}`)).json();
  const mv = (p.moves || "").split(" ").filter(Boolean);
  const sq = mv[1].slice(0, 2);
  const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]), s = info.rect.w / 8;
  const x = info.rect.x + f * s + s / 2, y = info.rect.y + (8 - rk) * s + s / 2;
  console.log("clicking", sq, "at", Math.round(x), Math.round(y), "moves", mv[1]);
  await click(x, y);
  await sleep(800);
  console.log("markers after click:", await ev(`document.querySelectorAll('cg-board square.move-dest').length`));
  console.log("selected squares:", await ev(`document.querySelectorAll('cg-board square.selected').length`));
}
ws.close();
