/**
 * Verify the "feel" fixes:
 *  1. the opponent's first move ANIMATES (intermediate frames, not a teleport)
 *  2. back/forward controls exist, step the board, and do NOT score the puzzle
 *  3. sound is wired (an AudioContext gets created on interaction)
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
// Keep this test's clean-slate assumption: cross-device sync would otherwise
// re-import server state from an earlier run and break assertions like
// `attempts === 0` that have nothing to do with what is being tested.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Instrument AudioContext BEFORE the app can create one, so we can count cues.
await ev(`(() => {
  if (window.__soundProbe) return;
  window.__soundProbe = { contexts: 0, oscillators: 0 };
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;
  const Patched = function (...a) {
    const ctx = new Orig(...a);
    window.__soundProbe.contexts++;
    const co = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { window.__soundProbe.oscillators++; return co(); };
    return ctx;
  };
  Patched.prototype = Orig.prototype;
  window.AudioContext = Patched;
  window.webkitAudioContext = Patched;
})()`);

// --- start a puzzle and watch the FIRST MOVE for animation frames -----------
await ev(`(() => { const b=[...document.querySelectorAll('main button')].find(x=>/Random Puzzle/i.test(x.innerText)); b&&b.click(); })()`);
const frames = [];
for (let i = 0; i < 26; i++) {
  frames.push(await ev(`(() => [...document.querySelectorAll('piece')].map(e=>e.style.transform).join('|'))()`));
  await sleep(60);
}
const fUniq = [...new Set(frames.filter(Boolean))];
console.log(`first-move: ${frames.length} samples, ${fUniq.length} distinct board states`);
// A teleport gives exactly 1 stable state after the initial (empty) frames.
// An animation gives several genuinely different intermediate layouts.
const nonEmpty = fUniq.filter(s => s.length > 0);
console.log(`  non-empty distinct states: ${nonEmpty.length}`);
ok(nonEmpty.length >= 3, `opponent's first move renders INTERMEDIATE frames => it animates (${nonEmpty.length} states)`);

const probe1 = await ev(`JSON.stringify(window.__soundProbe)`);
console.log("sound probe after start:", probe1);

// --- back / forward --------------------------------------------------------
const nav = await ev(`(() => ({
  hasBack: !!document.querySelector('[data-testid="move-back"]'),
  hasForward: !!document.querySelector('[data-testid="move-forward"]'),
  pos: document.querySelector('[data-testid="move-nav-position"]')?.innerText ?? null,
}))()`);
console.log("nav:", JSON.stringify(nav));
ok(nav.hasBack && nav.hasForward, "back/forward controls render");
ok(!!nav.pos, `position indicator present (${nav.pos})`);

const beforeBack = await ev(`(() => [...document.querySelectorAll('piece')].map(e=>e.style.transform).join('|'))()`);
await ev(`document.querySelector('[data-testid="move-back"]').click()`);
await sleep(900);
const afterBack = await ev(`(() => [...document.querySelectorAll('piece')].map(e=>e.style.transform).join('|'))()`);
const posAfter = await ev(`document.querySelector('[data-testid="move-nav-position"]')?.innerText ?? null`);
console.log(`after back: position "${posAfter}", board changed = ${beforeBack !== afterBack}`);
ok(beforeBack !== afterBack, "stepping back actually changes the displayed position");
ok(/0 \/ /.test(posAfter ?? ""), `stepped to the start (${posAfter})`);

const liveBtn = await ev(`!!document.querySelector('[data-testid="move-nav-position"][data-live="false"]')`);
ok(liveBtn, "a 'back to position' affordance appears while reviewing");

// Critically: reviewing must NOT create an attempt or touch the ladder.
const stateDuring = await ev(`(() => ({
  attempts: (JSON.parse(localStorage.getItem('puzzle_trainer_attempts')||'[]')).length,
  progress: Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2')||'{}')).length,
  glicko: !!localStorage.getItem('puzzle_trainer_glicko_v1'),
}))()`);
console.log("state while reviewing:", JSON.stringify(stateDuring));
ok(stateDuring.attempts === 0, "reviewing records NO attempt (puzzle not marked failed)");
ok(stateDuring.progress === 0, "reviewing writes NO SM-2 progress");
ok(!stateDuring.glicko, "reviewing does NOT touch the rating");

// forward again
await ev(`document.querySelector('[data-testid="move-forward"]').click()`);
await sleep(700);
const posFwd = await ev(`document.querySelector('[data-testid="move-nav-position"]')?.innerText ?? null`);
console.log(`after forward: "${posFwd}"`);
ok(posFwd !== posAfter, `forward advances again (${posFwd})`);

// --- sound: play a move, expect oscillators -------------------------------
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
  await sleep(450); };

await ev(`(() => { const b=document.querySelector('[data-testid="move-nav-position"]'); b&&!b.disabled&&b.click(); })()`);
await sleep(400);
const mv = moves[1];
await tap(mv.slice(0,2));
await tap(mv.slice(2,4));
await sleep(1500);

const probe2 = await ev(`JSON.stringify(window.__soundProbe)`);
console.log("sound probe after a move:", probe2);
const pr = JSON.parse(probe2 ?? "{}");
ok(pr.oscillators > 0, `playing a move created audio oscillators (${pr.oscillators}) => sound is wired`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
