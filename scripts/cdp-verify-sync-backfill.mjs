/**
 * Reproduces the reported bug: pins and game history did NOT reach a second
 * browser, but a freshly-written mistake DID.
 *
 * Why that split happened: `pullState()` reconciled only keys the SERVER already
 * knew about. Everything written BEFORE sync was installed (pins set earlier, the
 * whole attempt history) had no clock entry and was never uploaded — so the
 * server only ever had progress_v2, which was written after sync existed.
 *
 * The test writes the "old" keys BYPASSING the wrapper (Storage.prototype.setItem
 * directly), which is exactly what a pre-sync write looks like: present locally,
 * no clock stamp. Then it reloads, and a SECOND browser must receive all three.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connect to a browser on a given CDP port.
 *
 * Two devices need two REAL browsers: two targets in one browser share a single
 * localStorage, so "device B" would already hold everything and the test would
 * pass without proving anything. Port 9245 = device A, 9246 = device B.
 */
async function connect(port) {
  const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
  const t = list.find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
  await new Promise((r) => ws.once("open", r));
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Runtime.enable");
  return { ws, send, ev, port };
}

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Server starts empty so we can prove what reaches it.
await fetch("http://localhost:3000/api/state?confirm=1", { method: "DELETE" }).catch(() => {});

const A = await connect(9245);
await A.send("Page.enable");
await A.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await A.send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);

// Start from a genuinely clean device A (a leftover `puzzle_trainer_sync=off`
// from an earlier test run would disable sync and make this vacuous).
await A.ev(`(() => { localStorage.clear(); sessionStorage.clear(); return 'cleared'; })()`);
await A.send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

// Simulate the PRE-SYNC writes: set the values, then DELETE their clock entries.
// (Deleting the stamp is the faithful way to reproduce this — the wrapper
// REPLACES Storage.prototype.setItem, so calling it "directly" does not bypass
// anything; a key with no clock entry is exactly what a pre-sync write looks
// like to pullState().)
await A.ev(`(() => {
  localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork','pin','mateIn1']));
  localStorage.setItem('puzzle_trainer_attempts', JSON.stringify(
    Array.from({length: 7}, (_, i) => ({ id:'old'+i, puzzleId:'0000'+i, fen:'', moves:'', themes:['fork'],
      rating:1500, success: i % 2 === 0, timeMs: 1000, timestamp: Date.now() - i * 3600000 }))
  ));
  localStorage.setItem('puzzle_trainer_progress_v2', JSON.stringify({
    '0000X': { puzzleId:'0000X', rung:0, nextDue: new Date(Date.now()-86400000).toISOString(),
               isWrongPuzzle:true, attempts:1, lastResult:'incorrect' },
  }));
  // Forge the "written before sync existed" condition.
  const clock = JSON.parse(localStorage.getItem('puzzle_trainer___sync_clock') || '{}');
  delete clock['puzzle_trainer_pinned_themes'];
  delete clock['puzzle_trainer_attempts'];
  delete clock['puzzle_trainer_progress_v2'];
  localStorage.setItem('puzzle_trainer___sync_clock', JSON.stringify(clock));
  return { clock: Object.keys(clock) };
})()`);

const serverBefore = await (await fetch("http://localhost:3000/api/state")).json();
console.log("server knows about (before reload):", Object.keys(serverBefore.state || {}));

// Reload so sync installs and reconciles — this is where the upload must happen.
await A.send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);

const serverAfter = await (await fetch("http://localhost:3000/api/state")).json();
const keysAfter = Object.keys(serverAfter.state || {});
console.log("server knows about (after reload):", keysAfter);

ok(keysAfter.includes("puzzle_trainer_pinned_themes"),
   "pins that predate sync get UPLOADED on next boot");
ok(keysAfter.includes("puzzle_trainer_attempts"),
   "attempt history that predates sync gets UPLOADED on next boot");
ok(keysAfter.includes("puzzle_trainer_progress_v2"),
   "progress still syncs");
ok(!keysAfter.includes("puzzle_trainer_sync"),
   "the SYNC OPT-OUT is never uploaded (would disable sync on every device)");

// ---- Device B: a fresh browser must receive ALL of it ----
const B = await connect(9246);
await B.send("Page.enable");
await B.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await B.send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() + "&device=B" });
await sleep(13000);
// Clear B's own copy WITHOUT wiping the shared server, then reload so it must pull.
await B.ev(`(() => {
  const raw = Storage.prototype.setItem;
  localStorage.removeItem('puzzle_trainer_pinned_themes');
  localStorage.removeItem('puzzle_trainer_attempts');
  localStorage.removeItem('puzzle_trainer_progress_v2');
  localStorage.removeItem('puzzle_trainer___sync_clock');
  sessionStorage.clear();
  return raw ? 'cleared' : 'cleared';
})()`);
await B.send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() + "&device=B2" });
await sleep(15000);

const seen = await B.ev(`(() => {
  const p = localStorage.getItem('puzzle_trainer_pinned_themes');
  const a = localStorage.getItem('puzzle_trainer_attempts');
  const g = localStorage.getItem('puzzle_trainer_progress_v2');
  return {
    pins: p ? JSON.parse(p) : null,
    attempts: a ? JSON.parse(a).length : 0,
    progress: g ? Object.keys(JSON.parse(g)).length : 0,
  };
})()`);
console.log("device B sees:", JSON.stringify(seen));

ok(Array.isArray(seen.pins) && seen.pins.length === 3,
   `device B received the PINS (${JSON.stringify(seen.pins)})`);
ok(seen.attempts === 7, `device B received the ATTEMPT HISTORY (${seen.attempts} of 7)`);
ok(seen.progress >= 1, `device B received the mistake queue (${seen.progress})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
A.ws.close(); B.ws.close();
process.exit(fail ? 1 : 0);
