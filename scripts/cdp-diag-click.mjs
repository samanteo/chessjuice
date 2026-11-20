/**
 * Does a single click pair move a piece at all?
 * Tries several input strategies against chessground, and reports which work.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
// --- HARNESS ISOLATION GUARD: opt out of sync BEFORE the app boots -----------
// `Page.addScriptToEvaluateOnNewDocument` runs in the new document BEFORE any
// page script, so `puzzle_trainer_sync==='off'` is in place before
// installStateSync() runs. The app then neither PULLS from nor PUSHES to the
// user's real /api/state store. Setting the flag AFTER the first load is too
// late — the app has already booted and may already have pushed (that is how a
// fake quickStartCount/rating leaked into the user's real state).
// ONE mechanism, identical in every harness in this directory.
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}",
});
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await evalJs(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await evalJs(`(() => { const b=[...document.querySelectorAll('main button')].find(x=>/Random Puzzle/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(9000);

const shown = await evalJs(`(() => { const m = document.querySelector('main').innerText.match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
const pz = await (await fetch(`http://localhost:3000/api/puzzle?id=${shown}`)).json();
const puzzle = pz.puzzle ?? pz;
const moves = puzzle.moves.split(" ");
console.log(`puzzle ${shown}  moves "${puzzle.moves}"  solver plays ${moves[1]} (index 1)`);

const geo = await evalJs(`(() => {
  const b = document.querySelector('cg-board');
  const r = b.getBoundingClientRect();
  const wrap = b.closest('.cg-wrap') || b.parentElement;
  const cls = (wrap?.className||'') + ' ' + (b.className||'');
  return { x: r.left, y: r.top, w: r.width, orient: /black/i.test(cls) ? 'black' : 'white' };
})()`);
const sq = geo.w / 8;
const FILES = "abcdefgh";
const xy = (name) => {
  const file = name.charCodeAt(0) - 97;
  const rank = parseInt(name[1], 10);
  const col = geo.orient === "white" ? file : 7 - file;
  const row = geo.orient === "white" ? 8 - rank : rank - 1;
  return { x: geo.x + col * sq + sq / 2, y: geo.y + row * sq + sq / 2 };
};
console.log("geometry:", JSON.stringify(geo));

const readBoard = async () => evalJs(`(() => {
  const b = document.querySelector('cg-board');
  const r = b.getBoundingClientRect(); const s = r.width/8;
  const wrap = b.closest('.cg-wrap') || b.parentElement;
  const orient = /black/i.test((wrap?.className||'')+' '+(b.className||'')) ? 'black':'white';
  const files='abcdefgh'; const out={};
  for (const el of document.querySelectorAll('piece')) {
    const m = (el.style.transform||'').match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/);
    if(!m) continue;
    const col=Math.round(parseFloat(m[1])/s), row=Math.round(parseFloat(m[2])/s);
    if(col<0||col>7||row<0||row>7) continue;
    out[orient==='white'? files[col]+(8-row) : files[7-col]+(row+1)] = el.className.includes('white')?'W':'B';
  }
  return out;
})()`);

const from = moves[1].slice(0,2), to = moves[1].slice(2,4);
const A = xy(from), B = xy(to);
console.log(`clicking ${from}(${Math.round(A.x)},${Math.round(A.y)}) -> ${to}(${Math.round(B.x)},${Math.round(B.y)})`);

const before = await readBoard();
console.log(`before: ${from}=${before[from]??'-'}  ${to}=${before[to]??'-'}`);

// ---- strategy 1: mousePressed / mouseReleased ----
async function strat1() {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: A.x, y: A.y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: A.x, y: A.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: A.x, y: A.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(400);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: B.x, y: B.y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: B.x, y: B.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: B.x, y: B.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(900);
}
await strat1();
let after = await readBoard();
console.log(`after mouse: ${from}=${after[from]??'-'}  ${to}=${after[to]??'-'}`);
const mouseWorked = before[from] && !after[from] && after[to];

// ---- strategy 2: CDP touch events ----
if (!mouseWorked) {
  console.log("mouse did not move it; trying touch…");
  const touch = async (pt) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y }] });
    await sleep(80);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
  };
  await touch(A); await touch(B); await sleep(900);
  after = await readBoard();
  console.log(`after touch: ${from}=${after[from]??'-'}  ${to}=${after[to]??'-'}`);
}

// ---- what is chessground's config? ----
const cfg = await evalJs(`(() => {
  const wrap = document.querySelector('.cg-wrap');
  const board = document.querySelector('cg-board');
  return {
    wrapClasses: (wrap?.className||''),
    boardTag: board?.tagName,
    hasCgBase: document.querySelectorAll('.cg-wrap').length,
    // chessground binds on the wrapper element
    wrapRect: wrap ? (() => { const r = wrap.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; })() : null,
    targetAt: (() => { try { const el = document.elementFromPoint(195, 300); return el?.tagName + '.' + (el?.className||''); } catch(e){ return 'err'; } })(),
  };
})()`);
console.log("config:", JSON.stringify(cfg));

const A2 = await readBoard();
const moved = before[from] && !A2[from] && A2[to];
console.log(`\nRESULT: piece moved = ${moved}`);
ws.close();
process.exit(moved ? 0 : 1);