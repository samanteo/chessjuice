/**
 * DIAGNOSTIC: why doesn't clicking drive the puzzle?
 * Compare the live chessground position against the puzzle's FEN board field, and
 * report the turn/state the app thinks it is in.
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
console.log(`puzzle ${shown}  fen ${puzzle.fen}`);
console.log(`moves "${puzzle.moves}"`);

// FEN board field -> square map
function fenToBoard(fen) {
  const files = "abcdefgh";
  const rows = fen.split(" ")[0].split("/");
  const out = {};
  rows.forEach((row, r) => {
    let col = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { col += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? "W" : "B";
      out[files[col] + (8 - r)] = color;
      col++;
    }
  });
  return out;
}
const fenBoard = fenToBoard(puzzle.fen);
console.log(`FEN board pieces: ${Object.keys(fenBoard).length}`);
console.log("fen side-to-move:", puzzle.fen.split(" ")[1]);

// Live board
const live = await evalJs(`(() => {
  const b = document.querySelector('cg-board');
  const r = b.getBoundingClientRect();
  const wrap = b.closest('.cg-wrap') || b.parentElement;
  const cls = (wrap?.className||'') + ' ' + (b.className||'');
  const orient = /black/i.test(cls) ? 'black' : 'white';
  const s = r.width / 8;
  const out = {};
  for (const el of document.querySelectorAll('piece')) {
    const m = (el.style.transform||'').match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/);
    if (!m) continue;
    const col = Math.round(parseFloat(m[1]) / s);
    const row = Math.round(parseFloat(m[2]) / s);
    if (col<0||col>7||row<0||row>7) continue;
    const files='abcdefgh';
    const name = orient === 'white' ? files[col]+(8-row) : files[7-col]+(row+1);
    out[name] = el.className.includes('white') ? 'W' : 'B';
  }
  return { orient, board: out, cgClasses: cls.trim() };
})()`);
console.log(`live pieces: ${Object.keys(live.board).length}  orient=${live.orient}`);
console.log("cg classes:", live.cgClasses);

// diff
const allSquares = new Set([...Object.keys(fenBoard), ...Object.keys(live.board)]);
const diffs = [];
for (const s of allSquares) {
  const a = fenBoard[s] ?? "-", b = live.board[s] ?? "-";
  if (a !== b) diffs.push(`${s}: fen=${a} live=${b}`);
}
console.log(`\nDIFF fen vs live (${diffs.length}):`);
console.log(diffs.slice(0, 12).join("\n"));

// Is any piece selected / what does chessground expose?
const state = await evalJs(`(() => {
  const wrap = document.querySelector('.cg-wrap');
  return {
    hasWrap: !!wrap,
    squares: document.querySelectorAll('square').length,
    lastMoveSquares: [...document.querySelectorAll('square.move-dest')].length,
    selected: document.querySelectorAll('square.selected').length,
    lastMove: [...document.querySelectorAll('square.last-move')].map(e=>e.getAttribute('style')),
    turnText: document.querySelector('main').innerText.match(/White to move|Black to move|Your turn|puzzle solved|Solved|Correct|Wrong/i)?.[0] ?? null,
  };
})()`);
console.log("state:", JSON.stringify(state));
ws.close();
process.exit(0);
