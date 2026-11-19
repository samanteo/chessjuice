/**
 * 1. The All-themes label bug (click Fork -> "Advanced pawn") is fixed.
 * 2. Jobava London is reachable: Lichess files it as "Rapport-Jobava System",
 *    and typing "jobava" must surface it in BOTH the Add-theme picker and the
 *    All themes search.
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

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`localStorage.clear()`);
// Keep this test's clean-slate assumption: cross-device sync would otherwise
// re-import server state from an earlier run and break assertions like
// `attempts === 0` that have nothing to do with what is being tested.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };
const setInput = (sel, val) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);

// ---- 1. All themes: click a named theme, label must match --------------
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(4000);
for (const want of ["Fork", "Pin"]) {
  await ev(`(() => {
    const row = [...document.querySelectorAll('button')].find(b => (b.innerText||"").includes(${JSON.stringify(want)}) && b.querySelector('h4'));
    row && row.click();
  })()`);
  await sleep(6000);
  const label = await ev(`document.querySelector('[data-testid="active-theme"]')?.innerText ?? null`);
  ok(label === want, `All themes: clicking "${want}" labels the board "${label}"`);
}

// ---- 2. Jobava findable in the All themes search ----------------------
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/All themes/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2500);
const searchSel = await ev(`(() => { const i=document.querySelector('input[placeholder*="Search themes"]'); return i ? 'input[placeholder*="Search themes"]' : null; })()`);
ok(!!searchSel, "All themes has a search input");
if (searchSel) {
  await setInput(searchSel, "jobava");
  await sleep(2500);
  const hits = await ev(`(() => [...document.querySelectorAll('button')].map(b=>(b.innerText||"")).filter(t=>/jobava/i.test(t)).slice(0,4))()`);
  console.log("   all-themes search hits:", JSON.stringify(hits));
  ok(hits.length > 0, "All themes search finds the Jobava/Rapport-Jobava entry");
  await setInput(searchSel, "");
  await sleep(800);
}

// ---- 3. Jobava findable in the Add-theme picker ----------------------
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Training/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2000);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Add theme/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(2500);
const pickSearch = await ev(`(() => {
  const i=[...document.querySelectorAll('[role="dialog"] input, input')].find(x=>/search/i.test(x.placeholder||""));
  return i ? (i.placeholder||"ok") : null;
})()`);
console.log("   picker search:", pickSearch);
const pickerInput = await ev(`(() => {
  const i=[...document.querySelectorAll('input')].find(x=>/search/i.test(x.placeholder||""));
  if(!i) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
  setter.call(i,"jobava");
  i.dispatchEvent(new Event("input",{bubbles:true}));
  return true;
})()`);
await sleep(2500);
const pickHits = await ev(`(() => [...document.querySelectorAll('[data-testid^="picker-opening-"]')].map(e=>e.getAttribute('data-testid')).slice(0,5))()`);
console.log("   picker opening hits:", JSON.stringify(pickHits));
ok(pickerInput && pickHits && pickHits.length > 0, `Add-theme picker finds it too (${(pickHits||[]).join(", ")})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
