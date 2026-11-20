/** After a commit, does state SURVIVE a reload? (rating, attempts, review queue) */
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
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// The browser still holds the state from the previous solve. Snapshot it.
const state = await evalJs(`(() => ({
  attempts: (JSON.parse(localStorage.getItem('puzzle_trainer_attempts')||'[]')).length,
  progress: Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2')||'{}')).length,
  glicko: localStorage.getItem('puzzle_trainer_glicko_v1'),
  settingsRating: JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').rating,
}))()`);
console.log("BEFORE reload:", JSON.stringify(state));

// Reload.
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
await sleep(16000);

const after = await evalJs(`(() => {
  const t = document.querySelector('main').innerText;
  return {
    attempts: (JSON.parse(localStorage.getItem('puzzle_trainer_attempts')||'[]')).length,
    progress: Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2')||'{}')).length,
    glicko: localStorage.getItem('puzzle_trainer_glicko_v1'),
    settingsRating: JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').rating,
    displayedRating: (t.match(/Your rating:\\s*\\n?\\s*(\\d{3,4})/) ?? [])[1] ?? null,
    streak: (t.match(/Streak:\\s*\\n?\\s*(\\d+)/) ?? [])[1] ?? null,
  };
})()`);
console.log("AFTER  reload:", JSON.stringify(after));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };
ok(after.attempts === state.attempts && after.attempts > 0, `attempts survive reload (${after.attempts})`);
ok(
  typeof after.settingsRating === "number" && after.settingsRating > 1500,
  `rating survives reload (${after.settingsRating})`,
);
ok(
  after.displayedRating === String(after.settingsRating),
  `displayed rating matches persisted (${after.displayedRating})`,
);
ok(after.streak !== null && Number(after.streak) > 0, `streak survives reload (${after.streak})`);
console.log(`\n  PASS ${pass}   FAIL ${fail}`);
ws.close();
process.exit(fail ? 1 : 0);