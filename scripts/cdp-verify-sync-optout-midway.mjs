/**
 * The mid-session opt-out must actually stop WRITES.
 *
 * Regression test for the accident where a test harness loaded the app (sync ON),
 * then set `puzzle_trainer_sync='off'` and wrote its own seed values — and the
 * engine, which only read the flag at install time, pushed those seeds over the
 * user's real state.
 *
 * Method: load with sync ON, snapshot the SERVER's settings, then set the opt-out
 * and write a poisoned settings value locally. The local value must change; the
 * SERVER's copy must not.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await (await fetch("http://localhost:3000/api/state")).json());

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

import { WebSocket } from "ws";
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

const serverSettings = async () => {
  const s = await state();
  const st = (s.state ?? s)["puzzle_trainer_settings"];
  const v = typeof st?.v === "string" ? JSON.parse(st.v) : st?.v;
  return { rating: v?.rating, quickStartCount: v?.quickStartCount, t: st?.t };
};

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// Load with sync ON — do NOT set the opt-out before load; that is the whole point.
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);

const before = await serverSettings();
console.log("server settings before:", JSON.stringify(before));

// Now opt out mid-session and poison the local copy.
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 999, quickStartCount: 9 }))`);
// Nudge every flush trigger the app has.
await ev(`window.dispatchEvent(new Event('blur'))`);
await ev(`document.dispatchEvent(new Event('visibilitychange'))`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(5000);

const local = await ev(`localStorage.getItem('puzzle_trainer_settings')`);
const after = await serverSettings();
console.log("local settings now:", local);
console.log("server settings after:", JSON.stringify(after));

ok(/"rating":999/.test(local ?? ""), "the LOCAL copy did change (so we really wrote something)");
ok(after.rating === before.rating && after.quickStartCount === before.quickStartCount,
   `the SERVER copy is untouched (rating ${before.rating} -> ${after.rating})`);
ok(after.rating !== 999, "the poisoned seed (rating 999) never reached the server");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close(); process.exit(fail ? 1 : 0);
