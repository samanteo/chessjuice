/** Capture the KEYS inside each PUT body, to see what is never being sent. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fetch("http://localhost:3000/api/state?confirm=1", { method: "DELETE" });

const list = await (await fetch("http://localhost:9247/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map(); const puts = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent" && m.params.request.method === "PUT" && (m.params.request.url || "").includes("/api/state")) {
    let keys = [];
    try { keys = Object.keys(JSON.parse(m.params.request.postData || "{}")); } catch {}
    puts.push({ bytes: (m.params.request.postData || "").length, keys });
  }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await ev(`(() => {
  localStorage.removeItem('puzzle_trainer_sync');
  localStorage.removeItem('puzzle_trainer___sync_clock');
  sessionStorage.clear();
  return 'reset';
})()`);

await send("Page.navigate", { url: "http://localhost:3000/?keys=" + Date.now() });
await sleep(20000);

console.log("=== PUT bodies ===");
const sent = new Set();
for (const p of puts) {
  console.log(`  ${String(p.bytes).padStart(6)} bytes -> ${p.keys.join(", ")}`);
  p.keys.forEach((k) => sent.add(k));
}
console.log("\nkeys ever sent:");
for (const k of Array.from(sent).sort()) console.log("   ", k);

const srv = await (await fetch("http://localhost:3000/api/state")).json();
const stored = Object.keys(srv.state || {});
console.log("\nstored on server:", stored.sort().join("\n                 "));

const diff = Array.from(sent).filter((k) => !stored.includes(k));
console.log("\nSENT BUT NOT STORED:", diff.length ? diff.join(", ") : "(none)");

const never = ["puzzle_trainer_progress_v2","puzzle_trainer_theme_agg_v1"].filter(k => !sent.has(k));
console.log("NEVER SENT AT ALL:", never.length ? never.join(", ") : "(none)");
ws.close();
