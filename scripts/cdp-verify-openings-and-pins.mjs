/**
 * 1. Openings on All themes all dispense (was: in-memory pool -> silent no-op).
 * 2. "Pin all shown" no longer pins ~100 themes in one tap.
 * 3. "Unpin all" clears the pins so the Training tab is usable again.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const reqs = []; const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") {
    const u = m.params?.request?.url ?? "";
    if (/\/api\/dispense/.test(u)) reqs.push(u.replace("http://localhost:3000",""));
  } else if (m.method) events.push(m);
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// ---- 1. Openings dispense -------------------------------------------------
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3500);
await ev(`document.querySelector('[data-testid="openings-toggle"]')?.click()`);
await sleep(2500);
for (let i = 0; i < 4; i++) {
  reqs.length = 0;
  const name = await ev(`(() => {
    const l = document.querySelector('[data-testid="openings-list"]');
    const b = l && [...l.querySelectorAll('button')][${i}];
    if (!b) return null;
    const t = (b.innerText||"").split("\\n")[0].trim();
    b.click(); return t;
  })()`);
  await sleep(6500);
  const st = await ev(`(() => ({
    board: !!document.querySelector('cg-board'),
    label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  }))()`);
  const fired = reqs.some(u => /opening=/.test(u));
  ok(st.board && fired, `opening "${name}" dispensed (board=${st.board}, request=${fired}, label=${st.label})`);
}

// ---- 2 + 3. Pin-all guard and Unpin all ----------------------------------
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Training/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2000);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Add theme/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(3000);

const pinAll = await ev(`(() => {
  const b = document.querySelector('[data-testid="picker-pin-all"]');
  return { label: b?.innerText ?? null, armed: b?.getAttribute('data-pin-all-armed') ?? null };
})()`);
console.log("pin-all button:", JSON.stringify(pinAll));
ok(/^Pin all shown \(\d+\)$/.test(pinAll.label ?? ""), `pin-all starts unarmed (${pinAll.label})`);

// One tap must NOT pin anything.
await ev(`document.querySelector('[data-testid="picker-pin-all"]').click()`);
await sleep(1200);
const afterOne = await ev(`(() => ({
  pinned: JSON.parse(localStorage.getItem('puzzle_trainer_pinned_themes')||'[]').length,
  armed: document.querySelector('[data-testid="picker-pin-all"]')?.getAttribute('data-pin-all-armed'),
  label: document.querySelector('[data-testid="picker-pin-all"]')?.innerText,
}))()`);
console.log("after ONE tap:", JSON.stringify(afterOne));
ok(afterOne.pinned === 0, "one tap pins NOTHING");
ok(afterOne.armed === "true", `one tap arms it (${afterOne.label})`);

// Second tap pins them all.
await ev(`document.querySelector('[data-testid="picker-pin-all"]').click()`);
await sleep(1800);
const afterTwo = await ev(`JSON.parse(localStorage.getItem('puzzle_trainer_pinned_themes')||'[]').length`);
console.log("after TWO taps, pinned =", afterTwo);
ok(afterTwo > 0, `two taps do pin (${afterTwo} pinned)`);

const trainingSwamped = await ev(`/Rook endgame/.test(document.querySelector('main')?.innerText||'')`);
ok(trainingSwamped, "Training tab now shows the bulk pins (reproducing your report)");

// Unpin all must rescue it.
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Add theme/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2000);
const unpin = await ev(`(() => {
  const b = document.querySelector('[data-testid="picker-unpin-all"]');
  if (!b) return null;
  const t = b.innerText; b.click(); return t;
})()`);
console.log("clicked:", unpin);
await sleep(1800);
const cleared = await ev(`JSON.parse(localStorage.getItem('puzzle_trainer_pinned_themes')||'[]').length`);
ok(cleared === 0, `"Unpin all" clears every pin (${unpin} -> ${cleared} left)`);

await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Close|Done|✕/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2000);
const restored = await ev(`/Pin your daily themes here/.test(document.querySelector('main')?.innerText||'')`);
ok(restored, "Training tab back to the empty pin state");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,200)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
