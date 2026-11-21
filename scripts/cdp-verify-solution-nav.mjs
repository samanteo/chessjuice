/**
 * Board nav acceptance test — the three defects reported after the Solution fix:
 *  1. "Solution" must NOT jump to the last move. A second tap must be a no-op
 *     (it used to re-append the line and land on the final position).
 *  2. The position counter must speak in the solver's moves ("1 / 3"), never the
 *     raw history index ("1 / 1" on a multi-move puzzle).
 *  3. On resolve, ALL of the puzzle's themes must be shown.
 *
 * The position is read from `data-fen` on [data-testid="board-stage"] — the
 * authoritative position on screen. A style hash is NOT reliable: two positions
 * can share one, and chessground animates, so a mid-flight frame looks unchanged.
 */
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

const snap = () => ev(`(() => {
  const stage = document.querySelector('[data-testid="board-stage"]');
  const pill = document.querySelector('[data-testid="move-counter"]');
  const themes = document.querySelector('[data-testid="puzzle-themes"]');
  const fwd = document.querySelector('[data-testid="move-forward"]');
  const back = document.querySelector('[data-testid="move-back"]');
  const nav = document.querySelector('[data-testid="move-nav-position"]');
  return {
    fen: stage?.getAttribute('data-fen') ?? null,
    counter: nav?.innerText?.trim() ?? null,
    scrubbing: nav?.getAttribute('data-live') === 'false',
    pill: pill?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
    themes: themes ? [...themes.querySelectorAll('.theme-chip')].map(e => e.innerText.trim()) : [],
    themesCount: themes?.getAttribute('data-count') ?? null,
    // The "White/Black to move" pill was removed — the colour dot in the title
    // row carries the solver's colour now. Assert the dot, not the pill.
    toMoveText: /White to move|Black to move/i.test(document.body.innerText) ? 'PRESENT' : null,
    colorDot: document.querySelector('[data-testid="solver-color-dot"]')?.dataset.color ?? null,
    canFwd: fwd ? !fwd.disabled : null,
    canBack: back ? !back.disabled : null,
    pieces: document.querySelectorAll('piece').length,
  };
})()`);

const clickSolution = () => ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); if(!b) return false; b.click(); return true; })()`);
const clickFwd = () => ev(`(() => { const b=document.querySelector('[data-testid="move-forward"]'); if(!b||b.disabled) return false; b.click(); return true; })()`);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// Isolated boot: sync OFF before the app's first script runs, so this test can
// never push its settings/pins into the user's real store.
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork']))`);
// Theme chips are OFF by default now (the TAGS switch), and this test asserts
// they all appear on reveal — so switch them on for the run.
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ showTags: true, quickStartCount: 6 }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);

const before = await snap();
console.log("before Solution:", JSON.stringify(before));
ok(!!before.fen, "the board exposes its position (data-fen)");
const bm = (before.counter ?? "").match(/^(\d+)\s*\/\s*(\d+)$/);
ok(!!bm, `counter is "n / total" (${before.counter})`);
if (bm) {
  ok(Number(bm[2]) > 1, `total is the puzzle's move count, not 1 (${before.counter})`);
  ok(Number(bm[1]) === 1, `starts at move 1 (${before.counter})`);
}
const pm = (before.pill ?? "").match(/of (\d+)/);
if (pm && bm) ok(pm[1] === bm[2], `pill total matches counter total (${pm[1]} = ${bm[2]})`);

// ---- 1. Solution lands at the START and stays there -------------------------
await clickSolution();
await sleep(2200);
const afterSolution = await snap();
console.log("after Solution:", JSON.stringify(afterSolution));
ok(afterSolution.fen === before.fen, "Solution does NOT move the board (it is already at the start of the line)");
ok(afterSolution.canFwd === true, "forward is enabled so the line can be stepped through");
ok(afterSolution.themes.length >= 3, `ALL themes shown on reveal (${afterSolution.themes.join(", ")})`);
ok(afterSolution.themesCount === String(afterSolution.themes.length), `theme count attr matches (${afterSolution.themesCount})`);
ok(afterSolution.toMoveText === null, "no 'to move' text anywhere — the colour dot carries the colour");
ok(afterSolution.colorDot === "white" || afterSolution.colorDot === "black", `the colour dot states the solver's colour (${afterSolution.colorDot})`);
ok(/Solution/i.test(afterSolution.pill ?? ""), `the pill reports the solution (${afterSolution.pill})`);

// A SECOND tap must not append the line again / jump to the end.
const second = await clickSolution();
await sleep(2200);
const afterSecond = await snap();
console.log("after 2nd Solution tap:", JSON.stringify(afterSecond));
ok(second === true, "the Solution button is still reachable");
ok(afterSecond.fen === afterSolution.fen, "2nd tap does NOT jump to the last move");
ok(afterSecond.counter === afterSolution.counter, `2nd tap leaves the counter alone (${afterSecond.counter})`);

// ---- stepping forward actually advances the position ------------------------
const steps = [];
for (let i = 0; i < 10; i++) {
  const clicked = await clickFwd();
  if (!clicked) break;
  await sleep(1300);
  steps.push(await snap());
}
console.log("steps:", steps.map((s) => `${s.counter} ${s.fen?.split(" ")[0]}`).join(" | "));
ok(steps.length > 0, `the line can be stepped forward (${steps.length} steps)`);
const fens = [afterSolution.fen, ...steps.map((s) => s.fen)];
ok(new Set(fens).size === fens.length, `every step shows a distinct position (${new Set(fens).size}/${fens.length})`);
const lastCounter = steps.length ? steps[steps.length - 1].counter : null;
ok(Number((lastCounter ?? "0").split("/")[1]) === Number((afterSolution.counter ?? "0").split("/")[1]),
   `the total never changes while stepping (${lastCounter})`);
ok(Number((lastCounter ?? "0").split("/")[0]) === Number((afterSolution.counter ?? "0").split("/")[1]),
   `stepping to the end reaches the final move (${lastCounter})`);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
