/**
 * Is chessground animation actually ON, and does the opponent's first move
 * animate? Reads the flag off BOTH candidate elements, then samples a piece's
 * transform repeatedly across a solver move to catch a transition in flight.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
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
await sleep(13000);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

const flags = await ev(`(() => {
  const wrap = document.querySelector('.cg-wrap');
  const board = document.querySelector('cg-board');
  const attrs = (el) => el ? Object.fromEntries([...el.attributes].map(a=>[a.name, a.value])) : null;
  return { wrapAttrs: attrs(wrap), boardAttrs: attrs(board) };
})()`);
console.log("wrapper attrs:", JSON.stringify(flags.wrapAttrs));
console.log("board attrs  :", JSON.stringify(flags.boardAttrs));

// Start a puzzle and watch whether the opponent's first move animates:
// sample every piece's transform right after load.
await ev(`(() => { const b=[...document.querySelectorAll('main button')].find(x=>/Random Puzzle/i.test(x.innerText)); b&&b.click(); })()`);
const samples = [];
for (let i = 0; i < 14; i++) {
  const snap = await ev(`(() => [...document.querySelectorAll('piece')].map(e=>e.style.transform).join('|'))()`);
  samples.push(snap);
  await sleep(90);
}
const uniq = new Set(samples.filter(Boolean));
console.log(`\nfirst-move samples: ${samples.length}, distinct states: ${uniq.size}`);
console.log(uniq.size > 1
  ? "  -> the position CHANGED over time (could be animated or a late render)"
  : "  -> the position was ALREADY final at first sample (no animation)");

// Now play a solver move and sample for a transition in flight.
const shown = await ev(`(() => { const m = document.querySelector('main').innerText.match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
const pz = await (await fetch(`http://localhost:3000/api/puzzle?id=${shown}`)).json();
const puzzle = pz.puzzle ?? pz;
const moves = puzzle.moves.split(" ");
const geo = await ev(`(() => {
  const b=document.querySelector('cg-board'), r=b.getBoundingClientRect();
  const wrap=b.closest('.cg-wrap')||b.parentElement;
  return { x:r.left, y:r.top, w:r.width, orient:/black/i.test((wrap?.className||'')+' '+(b.className||''))?'black':'white' };
})()`);
const sq = geo.w/8;
const xy = (n) => { const f=n.charCodeAt(0)-97, rk=parseInt(n[1],10);
  const col = geo.orient==='white'? f : 7-f, row = geo.orient==='white'? 8-rk : rk-1;
  return { x: geo.x+col*sq+sq/2, y: geo.y+row*sq+sq/2 }; };
const tap = async (n) => { const {x,y}=xy(n);
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
  await sleep(70);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await sleep(400); };

const mv = moves[1];
console.log(`\nplaying solver move ${mv} and sampling transforms…`);
await tap(mv.slice(0,2));
const during = [];
const sampler = (async () => { for (let i=0;i<20;i++){ during.push(await ev(`(() => [...document.querySelectorAll('piece')].map(e=>e.style.transform).join('|'))()`)); await sleep(45); } })();
await tap(mv.slice(2,4));
await sampler;
const duniq = new Set(during.filter(Boolean));
console.log(`distinct transform states during the move: ${duniq.size}`);
console.log(duniq.size > 2
  ? "  -> INTERMEDIATE states observed => animation is RUNNING"
  : "  -> no intermediate states => the piece JUMPED (animation off)");
ws.close();
process.exit(0);
