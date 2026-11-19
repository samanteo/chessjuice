/**
 * The client's LAST batch can be aborted (navigation/unload). The backfill fix
 * means that is self-healing: any key the server does not hold is re-marked dirty
 * on the next load and pushed again. This verifies the count CONVERGES.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPECTED = [
  "puzzle_trainer_attempts","puzzle_trainer_progress_v2","puzzle_trainer_pinned_themes",
  "puzzle_trainer_settings","puzzle_trainer_glicko_v1","puzzle_trainer_theme_agg_v1",
  "puzzle_trainer_dashboard_agg_v1","puzzle_trainer_theme_prefs","puzzle_trainer_user_id",
];

await fetch("http://localhost:3000/api/state?confirm=1", { method: "DELETE" });

const list = await (await fetch("http://localhost:9247/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await ev(`(() => { localStorage.removeItem('puzzle_trainer_sync');
  localStorage.removeItem('puzzle_trainer___sync_clock'); sessionStorage.clear(); return 'reset'; })()`);

for (let load = 1; load <= 3; load++) {
  await send("Page.navigate", { url: `http://localhost:3000/?load${load}=` + Date.now() });
  await sleep(17000);
  const srv = await (await fetch("http://localhost:3000/api/state")).json();
  const keys = Object.keys(srv.state || {});
  const missing = EXPECTED.filter((k) => !keys.includes(k));
  console.log(`load ${load}: ${keys.length} keys, missing: ${missing.length ? missing.join(", ") : "none"}`);
  if (missing.length === 0) break;
}

const srv = await (await fetch("http://localhost:3000/api/state")).json();
const keys = Object.keys(srv.state || {});
const missing = EXPECTED.filter((k) => !keys.includes(k));

console.log("\n=== final ===");
for (const k of EXPECTED) {
  const e = srv.state[k];
  console.log(`  ${k.padEnd(40)} ${e ? String(e.v.length).padStart(8) + " bytes" : "MISSING"}`);
}

let att = 0, pins = 0, prog = 0, rating = null;
try { att = JSON.parse(srv.state["puzzle_trainer_attempts"].v).length; } catch {}
try { pins = JSON.parse(srv.state["puzzle_trainer_pinned_themes"].v).length; } catch {}
try { prog = Object.keys(JSON.parse(srv.state["puzzle_trainer_progress_v2"].v)).length; } catch {}
try { rating = JSON.parse(srv.state["puzzle_trainer_settings"].v).rating; } catch {}
console.log(`\nattempts=${att} pins=${pins} progress=${prog} rating=${rating}`);
console.log(missing.length === 0
  ? "\nRESULT: converged — every key synced."
  : `\nRESULT: still missing ${missing.join(", ")}`);
ws.close();
