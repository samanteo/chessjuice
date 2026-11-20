/** Does the theme show above the REVIEW board too? Seed a due mistake first. */
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
await sleep(12000);
await ev(`localStorage.clear()`);

// Keep this test's clean-slate assumption: cross-device sync would otherwise
// re-import server state from an earlier run and break assertions like
// `attempts === 0` that have nothing to do with what is being tested.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
// Seed a due mistake carrying an opening, so the Review board has something.
const pz = await (await fetch("http://localhost:3000/api/dispense?rating=1500&difficulty=normal&opening=sicilianDefense")).json();
const puzzle = pz.puzzle;
console.log("seeded mistake:", puzzle.id, JSON.stringify(puzzle.openings));
const now = Date.now();
const progressObj = {
  [puzzle.id]: {
    rg: 0, wr: 1, at: 1, co: 0,
    due: new Date(now - 60000).toISOString(),
    lr: new Date(now - 3600000).toISOString(),
    iw: 1,
  },
};
const attemptObj = {
  puzzleId: puzzle.id, userId: "local", result: "incorrect", moveNumber: 1, timeSpent: 4000,
  hintUsed: false, solutionViewed: false, ratingBefore: 1500, ratingAfter: 1490,
  timestamp: new Date(now - 3600000).toISOString(), puzzleRating: puzzle.rating,
  themes: puzzle.themes, openings: puzzle.openings ?? [],
};
await ev(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(progressObj))})`);
await ev(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify([attemptObj]))})`);

await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Review tab, then open the queued mistake.
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(4000);
const queue = await ev(`(() => {
  const item = document.querySelector('[data-testid^="queue-item-"]');
  return { present: !!item, id: item?.getAttribute('data-testid') ?? null };
})()`);
console.log("queue item:", JSON.stringify(queue));
ok(queue.present, `the seeded mistake is in the queue (${queue.id})`);

await ev(`(() => { const i=document.querySelector('[data-testid^="queue-item-"]'); i&&i.click(); })()`);
await sleep(6000);

const review = await ev(`(() => ({
  // The Review tab renders its own PuzzleBoard inline (not via renderBoardPanel),
  // so there is no data-board-context wrapper — detect the board itself.
  board: !!document.querySelector('cg-board'),
  nav: !!document.querySelector('[data-testid="move-nav"]'),
  label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  raw: document.querySelector('[data-testid="active-theme"]')?.getAttribute('data-angle') ?? null,
}))()`);
console.log("review board:", JSON.stringify(review));
ok(review.board && review.nav, "Review board renders (with the new move nav)");
ok(review.label !== null, `theme shown above the REVIEW board (${review.label})`);
ok(/Sicilian/i.test(review.label ?? ""), `and it is the puzzle's own opening, resolved to a label (${review.label})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
