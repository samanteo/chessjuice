/**
 * 1. Captures the automatic PUT so we can see WHY it fails.
 * 2. Then force-pushes the real data, which is the actual rescue.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch("http://localhost:9247/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map(); const net = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent" && (m.params.request.url || "").includes("/api/state")) {
    net.push({ phase: "request", method: m.params.request.method, post: (m.params.request.postData || "").length });
  }
  if (m.method === "Network.responseReceived" && (m.params.response.url || "").includes("/api/state")) {
    net.push({ phase: "response", status: m.params.response.status, url: m.params.response.url.slice(-20) });
  }
  if (m.method === "Network.loadingFailed") {
    net.push({ phase: "FAILED", err: m.params.errorText, type: m.params.type });
  }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

console.log("=== reloading to watch the automatic push ===");
await send("Page.navigate", { url: "http://localhost:3000/?probe=" + Date.now() });
await sleep(20000);

console.log("network to /api/state:");
for (const e of net) console.log("  ", JSON.stringify(e));

const srv1 = await (await fetch("http://localhost:3000/api/state")).json();
console.log("server keys after auto-push attempt:", Object.keys(srv1.state || {}).length);

// ---- FORCED RESCUE --------------------------------------------------------
console.log("\n=== forcing the push of every owned key ===");
const forced = await ev(`(async () => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('puzzle_trainer_')) continue;
    if (k === 'puzzle_trainer_sync' || k.endsWith('__sync_clock') || k === 'puzzle_trainer_sync_reloaded') continue;
    out[k] = { v: localStorage.getItem(k), t: Date.now() };
  }
  try {
    const r = await fetch('/api/state', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(out) });
    const j = await r.json();
    return { status: r.status, sent: Object.keys(out).length, bytes: JSON.stringify(out).length,
             applied: j.applied, rejected: j.rejected };
  } catch (e) { return { error: e.message }; }
})()`);
console.log("forced push:", JSON.stringify(forced));

await sleep(1500);
const srv = await (await fetch("http://localhost:3000/api/state")).json();
const keys = Object.keys(srv.state || {});
console.log("\n=== SERVER now holds ===");
console.log("keys:", keys.length);
for (const k of keys) {
  const v = srv.state[k].v ?? "";
  let summary = "";
  try { const q = JSON.parse(v); if (Array.isArray(q)) summary = `array(${q.length})`; else if (q && typeof q === "object") summary = `object(${Object.keys(q).length})`; } catch {}
  console.log(`  ${k.padEnd(40)} ${String(v.length).padStart(8)} bytes  ${summary}`);
}
try {
  const a = JSON.parse(srv.state["puzzle_trainer_attempts"].v);
  const pins = JSON.parse(srv.state["puzzle_trainer_pinned_themes"].v);
  const st = JSON.parse(srv.state["puzzle_trainer_settings"].v);
  console.log(`\n>>> RESCUED  attempts=${a.length}  pins=${pins.length}  rating=${st.rating}  solved=${st.totalSolved} failed=${st.totalFailed}`);
} catch (e) { console.log("summarise failed:", e.message); }
ws.close();
