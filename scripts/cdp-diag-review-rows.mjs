/** Diagnostic: what does the Review tab actually render, and which selector
 *  puts a mistake on the board? */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

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
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`(() => {
  const past = new Date(Date.now() - 86400000).toISOString();
  localStorage.setItem('puzzle_trainer_progress_v2', JSON.stringify({
    'testdue1': { puzzleId:'testdue1', rung:0, nextDue: past, isWrongPuzzle:true, attempts:1, lastResult:'incorrect' },
  }));
  localStorage.setItem('puzzle_trainer_attempts', JSON.stringify([{
    id:'a1', puzzleId:'testdue1', fen:'r2qk2r/pp3ppp/2n1pn2/2bp4/8/2N1PN2/PP3PPP/R1BQK2R w KQkq - 0 8',
    moves:'e1g1 d8c7', themes:['fork'], rating:1500, success:false, timeMs:1000, timestamp: Date.now(),
  }]));
})()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

console.log("=== which tabs exist ===");
console.log(await ev(`[...document.querySelectorAll('[data-testid^="tab-"]')].map(e=>e.getAttribute('data-testid')).join(', ')`));

await ev(`document.querySelector('[data-testid="tab-mistakes"]')?.click()`);
await sleep(1500);

console.log("\n=== all data-testid values on the Review tab ===");
console.log(await ev(`[...new Set([...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')))].join('\n')`));

console.log("\n=== buttons with visible text ===");
console.log(await ev(`[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>(b.getAttribute('data-testid')||'-')+' :: '+(b.innerText||'').trim().slice(0,40)).join('\n')`));

console.log("\n=== does the store think anything is due? ===");
console.log(JSON.stringify(await ev(`(() => {
  const raw = localStorage.getItem('puzzle_trainer_progress_v2');
  const prog = raw ? JSON.parse(raw) : {};
  const now = Date.now();
  const due = Object.values(prog).filter(p => new Date(p.nextDue).getTime() <= now);
  return { entries: Object.keys(prog).length, dueCount: due.length, sample: Object.values(prog)[0] ?? null };
})()`), null, 1));

console.log("\n=== body text (first 400 chars) ===");
console.log((await ev(`document.body.innerText`)).slice(0, 400));
ws.close();
