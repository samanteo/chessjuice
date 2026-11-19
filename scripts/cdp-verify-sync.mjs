/**
 * Cross-device sync: does progress made on "device A" really reach "device B"?
 *
 * Uses two SEPARATE BROWSER TARGETS (two CDP tabs) so they have genuinely
 * independent localStorage — that is what "different browser/device" means. If
 * this passes, the phone and the desktop will share progress.
 *
 * Also checks the failure mode that matters most: a SECOND device must never
 * wipe the first device's progress.
 */
const CDP = "http://localhost:9245";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openDevice(label) {
  const t = await (await fetch(`${CDP}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let id = 0; const pending = new Map(); const events = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Runtime.enable"); await send("Page.enable");
  return { label, ws, send, ev, events };
}

const boot = async (d) => {
  await d.send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(15000);
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const A = await openDevice("device-A");
const B = await openDevice("device-B");

// Wipe the SHARED state first. Without this, both devices boot, pull the server's
// copy from an earlier run, and start with progress they were supposed to make —
// so the assertions below would fail for the wrong reason.
await fetch("http://localhost:3000/api/state?confirm=1", { method: "DELETE" });

// Start both from a clean slate.
await boot(A);
await A.ev(`localStorage.clear(); sessionStorage.clear(); 'ok'`);
await boot(A);
await boot(B);
await B.ev(`localStorage.clear(); sessionStorage.clear(); 'ok'`);
await boot(B);

const serverAfterClear = await (await fetch("http://localhost:3000/api/state")).json();
console.log("server keys before:", serverAfterClear.keys);

// ---- Device A makes progress -------------------------------------------------
const aRating = 1731 + Math.floor(Math.random() * 100);
await A.ev(`localStorage.setItem('puzzle_trainer_glicko_v1', JSON.stringify({overall:{r:${aRating},d:200,v:0.09}})); 'set'`);
await A.ev(`localStorage.setItem('puzzle_trainer_progress_v2', JSON.stringify({"puzX":{rg:2,due:"2026-12-01T00:00:00Z",wr:1}})); 'set'`);
await sleep(2500); // let the debounced push fire

const afterPush = await (await fetch("http://localhost:3000/api/state")).json();
const serverRating = JSON.parse(afterPush.state?.["puzzle_trainer_glicko_v1"]?.v ?? "{}").overall?.r;
console.log("server rating after device A pushed:", serverRating, `(expected ${aRating})`);
ok(serverRating === aRating, `device A's progress reached the server (${serverRating})`);

// ---- Device B boots and should RECEIVE it ------------------------------------
const bLocal = await B.ev(`localStorage.getItem('puzzle_trainer_glicko_v1')`);
console.log("device B local before reload:", bLocal);
await boot(B);   // fresh boot -> pull -> adopt -> reload
const bAfter = await B.ev(`localStorage.getItem('puzzle_trainer_glicko_v1')`);
const bRating = JSON.parse(bAfter ?? "{}").overall?.r;
console.log("device B local after  reload:", bAfter);
ok(bRating === aRating, `device B received device A's rating (${bRating})`);

const bProgress = await B.ev(`localStorage.getItem('puzzle_trainer_progress_v2')`);
ok(/puzX/.test(bProgress ?? ""), "device B also received the SM-2 progress");

// ---- The important one: B must not wipe A ------------------------------------
await B.ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({rating:${aRating},streak:1})); 'set'`);
await sleep(2500);
const finalState = await (await fetch("http://localhost:3000/api/state")).json();
const kept = JSON.parse(finalState.state?.["puzzle_trainer_glicko_v1"]?.v ?? "{}").overall?.r;
console.log("server rating after device B wrote its own key:", kept);
ok(kept === aRating, `device B's push did NOT wipe device A's rating (kept ${kept})`);

const errsA = A.events.filter(e => e.method === "Runtime.exceptionThrown");
const errsB = B.events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errsA.length === 0 && errsB.length === 0, `no uncaught exceptions (A:${errsA.length} B:${errsB.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
try { A.ws.close(); B.ws.close(); } catch {}
process.exit(fail ? 1 : 0);
