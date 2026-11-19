/**
 * Rescues the user's real Brave data onto the server.
 *
 * Root cause of "it never synced": `puzzle_trainer_sync = "off"` was sitting in
 * the real profile. That key is the test opt-out — a stray flag from the test
 * harness. With it present, installStateSync() returns immediately and NOTHING is
 * ever pushed. Removing it and reloading lets the normal sync path run.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9247;

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 1. Clear the opt-out flag, then reload so sync actually installs.
const cleared = await ev(`(() => {
  const before = localStorage.getItem('puzzle_trainer_sync');
  localStorage.removeItem('puzzle_trainer_sync');
  sessionStorage.removeItem('puzzle_trainer_sync_reloaded');
  return { before, after: localStorage.getItem('puzzle_trainer_sync') };
})()`);
console.log("flag before/after:", JSON.stringify(cleared));

await send("Page.navigate", { url: "http://localhost:3000/?rescue=2&cb=" + Date.now() });
await sleep(16000);

// 2. Confirm sync is alive and the local copy is intact after the reload.
const local = await ev(`(() => {
  const a = localStorage.getItem('puzzle_trainer_attempts');
  const p = localStorage.getItem('puzzle_trainer_progress_v2');
  const pins = localStorage.getItem('puzzle_trainer_pinned_themes');
  const s = localStorage.getItem('puzzle_trainer_settings');
  return {
    attempts: a ? JSON.parse(a).length : 0,
    progress: p ? Object.keys(JSON.parse(p)).length : 0,
    pins: pins ? JSON.parse(pins).length : 0,
    rating: s ? JSON.parse(s).rating : null,
    syncFlag: localStorage.getItem('puzzle_trainer_sync'),
  };
})()`);
console.log("local copy after reload:", JSON.stringify(local));

// 3. What reached the server?
for (let i = 0; i < 8; i++) {
  const srv = await (await fetch("http://localhost:3000/api/state")).json();
  const keys = Object.keys(srv.state || {});
  const attemptsKey = srv.state?.["puzzle_trainer_attempts"];
  let n = 0;
  try { n = attemptsKey ? JSON.parse(attemptsKey.v).length : 0; } catch {}
  if (n >= 100) break;
  await sleep(2000);
}

const srv = await (await fetch("http://localhost:3000/api/state")).json();
const keys = Object.keys(srv.state || {});
console.log("\n=== SERVER now holds ===");
console.log("keys:", keys.length);
for (const k of keys) {
  const v = srv.state[k].v ?? "";
  let summary = "";
  try {
    const p = JSON.parse(v);
    if (Array.isArray(p)) summary = `array(${p.length})`;
    else if (p && typeof p === "object") summary = `object(${Object.keys(p).length})`;
  } catch {}
  console.log(`  ${k.padEnd(40)} ${String(v.length).padStart(7)} bytes  ${summary}`);
}
try {
  const a = JSON.parse(srv.state["puzzle_trainer_attempts"].v);
  console.log(`\n>>> RESCUED ATTEMPTS: ${a.length}`);
  const pins = JSON.parse(srv.state["puzzle_trainer_pinned_themes"].v);
  console.log(`>>> RESCUED PINS: ${pins.length} (${pins.slice(0, 5).join(", ")}...)`);
  const st = JSON.parse(srv.state["puzzle_trainer_settings"].v);
  console.log(`>>> RESCUED RATING: ${st.rating} · solved ${st.totalSolved} / failed ${st.totalFailed}`);
} catch (e) {
  console.log("could not summarise:", e.message);
}
ws.close();
