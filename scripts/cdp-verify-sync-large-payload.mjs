/**
 * Verifies the keepalive-cap fix: a real-sized payload (69 KB) must sync
 * AUTOMATICALLY, with no forcing.
 *
 * Before the fix, push() sent one 69,721-byte request with `keepalive: true`,
 * which exceeds the ~64 KiB cap — the browser rejected it before it left, and
 * because push() swallowed errors the failure was invisible.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Start clean so ANY key on the server proves the client pushed it.
await fetch("http://localhost:3000/api/state", { method: "DELETE" });

const list = await (await fetch("http://localhost:9247/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map(); const puts = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent" && m.params.request.method === "PUT" && (m.params.request.url || "").includes("/api/state")) {
    puts.push({ bytes: (m.params.request.postData || "").length });
  }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// Make sure the opt-out is gone and the clock is cleared so the local keys are
// re-stamped as "must upload".
await ev(`(() => {
  localStorage.removeItem('puzzle_trainer_sync');
  localStorage.removeItem('puzzle_trainer___sync_clock');
  sessionStorage.clear();
  return 'reset';
})()`);

await send("Page.navigate", { url: "http://localhost:3000/?verify=" + Date.now() });
await sleep(18000);

console.log("PUTs observed:", JSON.stringify(puts));
ok(puts.length > 0, `the client pushed automatically (${puts.length} PUT/s)`);
ok(puts.every((x) => x.bytes < 64000),
   `every PUT stays under the 64 KiB keepalive cap (max ${Math.max(0, ...puts.map(x => x.bytes))} bytes)`);
ok(puts.filter((x) => x.bytes > 1000).length >= 1,
   "a large (multi-KB) payload was actually sent, not just small ones");

const srv = await (await fetch("http://localhost:3000/api/state")).json();
const keys = Object.keys(srv.state || {});
console.log("server keys:", keys.length);
ok(keys.length >= 8, `the server received the full set (${keys.length} keys)`);

let att = 0, pins = 0, rating = null;
try { att = JSON.parse(srv.state["puzzle_trainer_attempts"].v).length; } catch {}
try { pins = JSON.parse(srv.state["puzzle_trainer_pinned_themes"].v).length; } catch {}
try { rating = JSON.parse(srv.state["puzzle_trainer_settings"].v).rating; } catch {}
console.log(`attempts=${att} pins=${pins} rating=${rating}`);
ok(att === 109, `all 109 attempts synced AUTOMATICALLY (${att})`);
ok(pins === 16, `all 16 pins synced (${pins})`);
ok(rating === 1096, `rating synced (${rating})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
