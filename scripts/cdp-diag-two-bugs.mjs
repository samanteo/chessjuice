/** Reproduce both reported bugs live. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const snap = () => ev(`(() => ({
  tab: (()=>{const b=[...document.querySelectorAll('nav button')].find(x=>/bg-blue|active/.test(x.className)&&/Training|Review|All themes|Analytics|Settings/.test(x.innerText)); return b?.innerText?.replace(/\\s+/g,' ').trim() ?? null})(),
  h1: document.querySelector('h1')?.innerText ?? null,
  board: !!document.querySelector('cg-board'),
  boardId: document.querySelector('.board-panel__title')?.innerText?.match(/#(\\w+)/)?.[1] ?? null,
  theme: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  randomBtn: !!([...document.querySelectorAll('button')].find(x=>/Random Puzzle/.test(x.innerText))),
  dueBtn: [...document.querySelectorAll('button')].find(x=>/Review Due/.test(x.innerText))?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
}))()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
// Seed a couple of DUE mistakes so "Review Due" is visible.
const r1 = await (await fetch("http://localhost:3000/api/dispense?rating=1500&difficulty=normal&theme=fork")).json();
const r2 = await (await fetch("http://localhost:3000/api/dispense?rating=1500&difficulty=normal&theme=pin")).json();
const now = Date.now();
const prog = {}; [r1.puzzle, r2.puzzle].forEach(px => {
  prog[px.id] = { rg: 0, wr: 1, at: 1, co: 0, due: new Date(now - 60000).toISOString(), lr: new Date(now - 3600000).toISOString(), iw: 1 };
});
await ev(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(prog))})`);
await ev(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify([r1.puzzle, r2.puzzle].map((px,i)=>({
  puzzleId: px.id, userId:"local", result:"incorrect", moveNumber:1, timeSpent:4000, hintUsed:false,
  solutionViewed:false, ratingBefore:1500, ratingAfter:1490, timestamp:new Date(now-3600000).toISOString(),
  puzzleRating:px.rating, themes:px.themes, openings:px.openings??[],
}))))})`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

console.log("=== A) FRESH LOAD (lands on Training) ===");
console.log(JSON.stringify(await snap(), null, 1));

console.log("\n=== B) go to All themes, click a theme, then come back to Training ===");
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);
await ev(`(() => { const row=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').includes('Fork') && b.querySelector('h4')); row&&row.click(); })()`);
await sleep(7000);
console.log("on All themes after clicking Fork:", JSON.stringify(await snap()));
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Training/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(4000);
console.log("back on Training:", JSON.stringify(await snap()));

console.log("\n=== C) tap 'Review Due' on the Training tab ===");
const before = await snap();
console.log("before:", JSON.stringify(before));
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Review Due/.test(x.innerText)); b&&b.click(); })()`);
await sleep(6000);
const after = await snap();
console.log("after :", JSON.stringify(after));
console.log("=> did a puzzle start?", after.board && after.boardId ? "YES " + after.boardId : "NO");

console.log("\n=== D) tap 'Review Due' inside the Review tab (empty state) ===");
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3500);
const rbefore = await snap();
console.log("review tab:", JSON.stringify(rbefore));
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Review Due/.test(x.innerText)); b&&b.click(); })()`);
await sleep(6000);
const rafter = await snap();
console.log("after     :", JSON.stringify(rafter));
console.log("=> did a puzzle start?", rafter.board && rafter.boardId ? "YES " + rafter.boardId : "NO");

ws.close();
