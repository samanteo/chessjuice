/**
 * The real end-to-end check: a CLEAN browser (fresh profile, empty localStorage)
 * opens the app and must pull the user's real data down from the server.
 *
 * This is what the phone will do.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const list = await (await fetch("http://localhost:9245/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// Start with NOTHING, like a brand-new phone. Do NOT set the sync opt-out.
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
await send("Page.navigate", { url: "http://localhost:3000/?fresh=" + Date.now() });
await sleep(12000);
await ev(`(() => { localStorage.clear(); sessionStorage.clear(); return 'wiped'; })()`);

// First load just bootstraps sync and writes defaults.
await send("Page.navigate", { url: "http://localhost:3000/?fresh2=" + Date.now() });
await sleep(16000);
// Second load is where the "reload once after adopting" should have landed.
await send("Page.navigate", { url: "http://localhost:3000/?fresh3=" + Date.now() });
await sleep(16000);

const seen = await ev(`(() => {
  const a = localStorage.getItem('puzzle_trainer_attempts');
  const pin = localStorage.getItem('puzzle_trainer_pinned_themes');
  const pr = localStorage.getItem('puzzle_trainer_progress_v2');
  const s = localStorage.getItem('puzzle_trainer_settings');
  return {
    attempts: a ? JSON.parse(a).length : 0,
    pins: pin ? JSON.parse(pin).length : 0,
    progress: pr ? Object.keys(JSON.parse(pr)).length : 0,
    rating: s ? JSON.parse(s).rating : null,
    syncFlag: localStorage.getItem('puzzle_trainer_sync'),
  };
})()`);
console.log("a clean browser now sees:", JSON.stringify(seen));

ok(seen.attempts === 109, `pulled the 109 puzzles (${seen.attempts})`);
ok(seen.pins === 16, `pulled the 16 pins (${seen.pins})`);
ok(seen.progress === 68, `pulled the 68-entry mistake queue (${seen.progress})`);
ok(seen.rating === 1096, `pulled the rating (${seen.rating})`);

// And the UI should reflect it.
const ui = await ev(`(() => {
  const txt = document.body.innerText;
  const pinned = [...document.querySelectorAll('[data-testid^="pin-"]')].length;
  return { hasRating: /1096/.test(txt), pinnedChips: pinned, sample: txt.slice(0, 160) };
})()`);
console.log("ui:", JSON.stringify({ hasRating: ui.hasRating, pinnedChips: ui.pinnedChips }));
ok(ui.hasRating, "the rating 1096 is visible in the UI");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
