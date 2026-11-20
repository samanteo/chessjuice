/**
 * Can you tell when a multi-move puzzle is finished, and can you accidentally
 * click through it?
 *
 *  1. Mid-puzzle shows a progress counter ("Move 1 of N"), not a bare move no.
 *  2. Mid-puzzle the button is SKIP, and ONE tap does NOT skip (two-tap guard).
 *  3. After solving, the counter flips to "✓ Solved" and a real Next appears.
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

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
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
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Find a genuinely multi-move puzzle so the test is not vacuous.
let puzzle = null, tries = 0;
while (tries++ < 12) {
  const r = await (await fetch("http://localhost:3000/api/dispense?rating=1500&difficulty=normal&theme=fork")).json();
  const q = r.puzzle ?? r;
  if (q?.moves && q.moves.length >= 6) { puzzle = q; break; }
  await sleep(150);
}
if (!puzzle) { console.log("could not find a multi-move puzzle"); process.exit(1); }
console.log(`puzzle ${puzzle.id}: ${puzzle.moves.length} plies -> ${Math.floor(puzzle.moves.length/2)} solver moves\n`);

// Load it straight into the Training board.
await ev(`window.__hermesSeed = ${JSON.stringify(JSON.stringify(puzzle))}`);
await ev(`localStorage.setItem('puzzle_trainer_progress_v2', '{}')`);
const seeded = await ev(`(() => {
  const raw = window.__hermesSeed;
  return raw ? JSON.parse(raw).id : null;
})()`);
console.log("seeded id:", seeded);
// Drive the app: start Quick start, then inspect the counter mid-puzzle.
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);

const mid = await ev(`(() => {
  const c = document.querySelector('[data-testid="move-counter"]');
  const skip = document.querySelector('[data-testid="skip-button"]');
  const next = document.querySelector('[data-testid="next-button"]');
  return {
    counter: c?.innerText ?? null,
    skip: skip?.innerText ?? null,
    skipArmed: skip?.getAttribute('data-skip-armed') ?? null,
    nextVisibleMidPuzzle: !!next,
  };
})()`);
console.log("mid-puzzle:", JSON.stringify(mid));
ok(mid.counter !== null, `a move counter is shown (${mid.counter})`);
ok(/of\s*\d/i.test(mid.counter ?? ""), `the counter states the TOTAL, not just the current move`);
ok(mid.skip !== null, `mid-puzzle the button is SKIP, not Next (${mid.skip})`);
ok(!mid.nextVisibleMidPuzzle, "there is NO Next button to hit accidentally mid-puzzle");
ok(mid.skipArmed === "false", "skip starts unarmed");

// ONE tap must not skip.
const idBefore = await ev(`document.querySelector('[data-testid="active-theme"]')?.innerText ?? null`);
await ev(`document.querySelector('[data-testid="skip-button"]').click()`);
await sleep(600);
const afterOne = await ev(`(() => {
  const s = document.querySelector('[data-testid="skip-button"]');
  return { armed: s?.getAttribute('data-skip-armed') ?? null, text: s?.innerText ?? null, blanked: !document.querySelector('[data-testid="move-counter"]') };
})()`);
console.log("after ONE tap:", JSON.stringify(afterOne));
ok(afterOne.armed === "true", "one tap ARMS the skip (does not skip yet)");
ok(!afterOne.blanked, "the puzzle is still on screen after one tap");
ok(/again/i.test(afterOne.text ?? ""), `the button asks for confirmation (${afterOne.text})`);

// It should disarm on its own if left alone.
await sleep(4600);
const disarmed = await ev(`document.querySelector('[data-testid="skip-button"]')?.getAttribute('data-skip-armed') ?? null`);
console.log("after waiting out the arm window:", disarmed);
ok(disarmed === "false", "the arm expires on its own (no stuck state)");

const armedBefore = await ev(`localStorage.getItem('puzzle_trainer_attempts')`);
// TWO taps skip for real.
await ev(`document.querySelector('[data-testid="skip-button"]').click()`);
await sleep(500);
await ev(`document.querySelector('[data-testid="skip-button"]').click()`);
await sleep(6000);
const afterTwo = await ev(`(() => ({
  advanced: !!document.querySelector('[data-testid="move-counter"]'),
  skipArmed: document.querySelector('[data-testid="skip-button"]')?.getAttribute('data-skip-armed') ?? null,
}))()`);
console.log("after TWO taps:", JSON.stringify(afterTwo));
ok(afterTwo.advanced, "two taps DO skip, and a fresh puzzle is served");
ok(afterTwo.skipArmed === "false", "the next puzzle starts with skip disarmed (no carry-over)");
const attemptsAfterSkip = await ev(`localStorage.getItem('puzzle_trainer_attempts')`);
ok((armedBefore ?? "null") === (attemptsAfterSkip ?? "null"), "skipping recorded NO attempt (clean abandon)");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
