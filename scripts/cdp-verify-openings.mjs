/**
 * A pinned id can be a THEME or an OPENING. Verify:
 *  1. a pinned OPENING renders a real label + count (not a disabled blank card)
 *  2. Quick start dispenses a puzzle for it (goes to /api/dispense?opening=…)
 *  3. the served puzzle really carries that opening
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear()`);
// Keep this test's clean-slate assumption: cross-device sync would otherwise
// re-import server state from an earlier run and break assertions like
// `attempts === 0` that have nothing to do with what is being tested.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
// Pin ONE theme and ONE opening.
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","sicilianDefense"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// 1. both pinned cards render meaningfully
const cards = await ev(`(() => {
  return [...document.querySelectorAll('[data-testid^="pinned-card-"]')].map(e => ({
    id: e.getAttribute('data-testid').replace('pinned-card-',''),
    kind: e.getAttribute('data-kind'),
    label: e.querySelector('div.font-semibold')?.innerText ?? null,
    count: e.querySelector('span')?.innerText ?? null,
    disabled: e.disabled,
  }));
})()`);
console.log("pinned cards:", JSON.stringify(cards, null, 1));
ok(cards.length === 2, `both pinned cards render (${cards.length})`);
const fork = cards.find(c => c.id === 'fork');
const sic = cards.find(c => c.id === 'sicilianDefense');
ok(fork?.kind === 'theme', "the theme card is typed as a theme");
ok(sic?.kind === 'opening', "the opening card is typed as an opening");
ok(sic?.label !== 'sicilianDefense', `opening card shows a real LABEL, not the raw id (${sic?.label})`);
ok(!!sic && !sic.disabled, "opening card is ENABLED (has a catalogue count)");
ok(sic?.count && sic.count !== '0', `opening card shows a non-zero count (${sic?.count})`);

// 2+3. Tap the OPENING card directly — that is the path a user takes to train an
// opening, and it exercises dispenseThemed with an opening id.
events.length = 0;
await ev(`(() => { const b=document.querySelector('[data-testid="pinned-card-sicilianDefense"]'); b&&b.click(); })()`);
await sleep(10000);

const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
const dispenseReqs = reqs.filter(u => u.includes("/api/dispense"));
console.log("dispense requests:", dispenseReqs.map(u => u.replace("http://localhost:3000","")).join("\n                    "));
ok(dispenseReqs.some(u => /opening=sicilianDefense/i.test(u)), "tapping the opening requests /api/dispense with the OPENING param");
ok(!dispenseReqs.some(u => /theme=sicilianDefense/i.test(u)), "it is NOT mis-sent as a theme");

const shown = await ev(`(() => { const m = document.querySelector('main').innerText.match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
console.log(`puzzle ${shown}`);
ok(!!shown, `a puzzle was dispensed for the opening (${shown})`);

if (shown) {
  const pz = await (await fetch(`http://localhost:3000/api/puzzle?id=${shown}`)).json();
  const puzzle = pz.puzzle ?? pz;
  console.log("served puzzle openings:", JSON.stringify(puzzle.openings));
  ok((puzzle.openings ?? []).some(o => /sicilianDefense/i.test(o)), "the served puzzle really belongs to that opening");
}

// And a Quick start RUN still works on themes.
events.length = 0;
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Quick start/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(9000);
const runReqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
const runDisp = runReqs.filter(u => u.includes("/api/dispense"));
console.log("run dispense:", runDisp.map(u => u.replace("http://localhost:3000","")).join(" | "));
ok(runDisp.some(u => /theme=fork/i.test(u)), "Quick start begins with the first pinned THEME (fork)");
const counter = await ev(`document.querySelector('[data-testid="quickrun-counter"]')?.innerText ?? null`);
ok(counter === "1 / 10", `counter running (${counter})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
