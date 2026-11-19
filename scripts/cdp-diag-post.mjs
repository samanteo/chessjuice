/**
 * Solve, then dump EVERYTHING: UI text, all localStorage keys, and whether the
 * app thinks the puzzle is solved. Tells us why no attempt is recorded.
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
console.log(`puzzle ${shown}  moves "${puzzle.moves}"`);

const geo = await evalJs(`(() => {
  const b = document.querySelector('cg-board'); const r = b.getBoundingClientRect();
  const wrap = b.closest('.cg-wrap') || b.parentElement;
  return { x:r.left, y:r.top, w:r.width, orient: /black/i.test((wrap?.className||'')+' '+(b.className||'')) ? 'black':'white' };
})()`);
const sq = geo.w / 8;
const xy = (n) => {
  const file = n.charCodeAt(0)-97, rank = parseInt(n[1],10);
  const col = geo.orient==='white'? file : 7-file;
  const row = geo.orient==='white'? 8-rank : rank-1;
  return { x: geo.x + col*sq + sq/2, y: geo.y + row*sq + sq/2 };
};
const tap = async (n) => {
  const { x, y } = xy(n);
  await send("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:[{x,y}] });
  await sleep(80);
  await send("Input.dispatchTouchEvent", { type:"touchEnd", touchPoints:[] });
  await sleep(650);
};
const readBoard = async () => evalJs(`(() => {
  const b=document.querySelector('cg-board'), r=b.getBoundingClientRect(), s=r.width/8;
  const wrap=b.closest('.cg-wrap')||b.parentElement;
  const orient=/black/i.test((wrap?.className||'')+' '+(b.className||''))?'black':'white';
  const files='abcdefgh', out={};
  for(const el of document.querySelectorAll('piece')){
    const m=(el.style.transform||'').match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/); if(!m) continue;
    const col=Math.round(parseFloat(m[1])/s), row=Math.round(parseFloat(m[2])/s);
    if(col<0||col>7||row<0||row>7) continue;
    out[orient==='white'?files[col]+(8-row):files[7-col]+(row+1)]=el.className.includes('white')?'W':'B';
  }
  return out;
})()`);

console.log("BEFORE solve, UI:");
console.log((await evalJs(`document.querySelector('main').innerText`)).slice(0, 500).replace(/\n+/g," | "));

for (let i = 1; i < moves.length; i += 2) {
  const mv = moves[i];
  console.log(`playing ${mv} …`);
  await tap(mv.slice(0,2));
  await tap(mv.slice(2,4));
  await sleep(1500);
}
await sleep(3000);

// A correct solve does NOT auto-commit: the app waits for you to press HARD
// (lucky guess) or "Next puzzle". Commit it the way a user would.
const preClick = await evalJs(`(() => ({
  hasNext: [...document.querySelectorAll('main button')].some(b=>/Next puzzle/i.test(b.innerText)),
  solved: /Correct!/.test(document.querySelector('main').innerText),
}))()`);
console.log("before Next:", JSON.stringify(preClick));
const clickedNext = await evalJs(`(() => {
  const b = [...document.querySelectorAll('main button')].find(x=>/Next puzzle/i.test(x.innerText));
  if (!b) return false;
  b.click();
  return true;
})()`);
console.log("clicked Next puzzle:", clickedNext);
await sleep(5000);

const after = await evalJs(`(() => ({
  text: document.querySelector('main').innerText.slice(0, 900),
  keys: Object.keys(localStorage),
  attempts: localStorage.getItem('puzzle_trainer_attempts'),
  progress: localStorage.getItem('puzzle_trainer_progress_v2'),
  glicko: localStorage.getItem('puzzle_trainer_glicko_v1'),
  buttons: [...document.querySelectorAll('main button')].map(b=>b.innerText.replace(/\\n/g,' ').trim()).filter(Boolean),
}))()`);
console.log("\n=== UI AFTER ===");
console.log(after.text.replace(/\n+/g, " | "));
console.log("\n=== buttons ===", JSON.stringify(after.buttons.slice(0,14)));
console.log("\n=== localStorage keys ===", JSON.stringify(after.keys));
console.log("attempts:", (after.attempts||"null").slice(0,200));
console.log("progress:", (after.progress||"null").slice(0,200));
console.log("glicko:", (after.glicko||"null").slice(0,200));
console.log("\nfinal board:", JSON.stringify(await readBoard()));
ws.close();
process.exit(0);