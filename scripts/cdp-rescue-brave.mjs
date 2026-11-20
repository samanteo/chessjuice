/**
 * Rescues the user's REAL data out of a copy of their Brave profile.
 *
 * The leveldb is Snappy-compressed, so the values are unreadable as raw bytes.
 * A browser reads it correctly for us: launch Brave against a COPY of the profile,
 * open the app, and read localStorage (and the hydrating store) through CDP.
 *
 * The app's own sync then pushes those values to /api/state — which is the rescue,
 * given the server was wiped of test data first.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9247;

// --- WRITE-BY-DESIGN RESCUE TOOL: explicit opt-in required --------------------
// Unlike the read/verify harnesses, this script's whole job is to PUSH a browser
// profile's data onto the shared /api/state store. It is the one class of tool
// here that intentionally writes real data, so it must never run by accident
// (e.g. swept up in a batch). Refuse unless explicitly acknowledged.
if (process.env.PUZZLE_TRAINER_ALLOW_RESCUE !== "1") {
  console.error("Refusing to run: this script overwrites the shared /api/state store.");
  console.error("Re-run with PUZZLE_TRAINER_ALLOW_RESCUE=1 if you really mean to rescue.");
  process.exit(0);
}

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// Load the copy's origin so localStorage is readable.
await send("Page.navigate", { url: "http://localhost:3000/?rescue=" + Date.now() });
await sleep(14000);

const raw = await ev(`(() => {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('puzzle_trainer_'));
  const attempts = localStorage.getItem('puzzle_trainer_attempts');
  const progress = localStorage.getItem('puzzle_trainer_progress_v2');
  const pins = localStorage.getItem('puzzle_trainer_pinned_themes');
  const glicko = localStorage.getItem('puzzle_trainer_glicko_v1');
  const settings = localStorage.getItem('puzzle_trainer_settings');
  const out = { keys, attemptCount: 0, progressCount: 0, pins: null, rating: null,
                totalSolved: null, totalFailed: null, streak: null, glickoOverall: null };
  try { out.attemptCount = attempts ? JSON.parse(attempts).length : 0; } catch {}
  try { out.progressCount = progress ? Object.keys(JSON.parse(progress)).length : 0; } catch {}
  try { out.pins = pins ? JSON.parse(pins) : null; } catch {}
  try { const s = settings ? JSON.parse(settings) : null;
        if (s) { out.rating = s.rating; out.totalSolved = s.totalSolved; out.totalFailed = s.totalFailed; out.streak = s.streak; } } catch {}
  try { const g = glicko ? JSON.parse(glicko) : null;
        if (g && g.overall) out.glickoOverall = { r: Math.round(g.overall.rating ?? g.overall.r), d: Math.round(g.overall.rd ?? g.overall.d) }; } catch {}
  return out;
})()`);

console.log("=== ORIGINAL BRAVE PROFILE (via the copy) ===");
console.log(JSON.stringify(raw, null, 2));

// Give the app's sync a moment to push, then report what the SERVER now holds.
await sleep(4000);
const srv = await (await fetch("http://localhost:3000/api/state")).json();
const keys = Object.keys(srv.state || {});
console.log("\n=== SERVER after the rescue profile loaded ===");
console.log("keys:", keys.length);
for (const k of keys) {
  const v = srv.state[k].v ?? "";
  console.log(`  ${k.padEnd(40)} ${String(v.length).padStart(7)} bytes`);
}
ws.close();
