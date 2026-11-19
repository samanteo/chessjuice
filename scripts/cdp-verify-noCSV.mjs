/**
 * Post-6M-migration smoke test: does the app still load and work with NO CSV?
 * Checks network (no /puzzles.csv request), counts, queue, and errors.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch("http://localhost:9245/json/list")).json();
      const p = list.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("no CDP page target");
}
const ws = new WebSocket(await target(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Seed progress so the lazy catalogue has something to hydrate.
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await evalJs(`(() => {
  const now = Date.now();
  const prog = {
    iztxj: { rg: 3, wr: true,  at: 5, co: 2, due: new Date(now - 3600000).toISOString(), lr: new Date(now-7200000).toISOString(), iw: true },
    '00008': { rg: 0, wr: true,  at: 3, co: 1, due: new Date(now - 86400000).toISOString(), lr: new Date(now-172800000).toISOString(), iw: true },
    '0000D': { rg: 2, wr: false, at: 1, co: 1, due: new Date(now + 86400000).toISOString(), lr: new Date(now).toISOString(), iw: false }
  };
  localStorage.setItem('puzzle_trainer_progress_v2', JSON.stringify(prog));
  const at = [{
    puzzleId:'iztxj', userId:'local', result:'incorrect', moveNumber:1, timeSpent:4000,
    hintUsed:false, solutionViewed:false, ratingBefore:1500, ratingAfter:1480,
    timestamp:new Date(now-7200000).toISOString(), puzzleRating:1591,
    themes:['advantage','discoveredAttack'], openings:['sicilianDefense'], angle:'sicilianDefense'
  }];
  localStorage.setItem('puzzle_trainer_attempts', JSON.stringify(at));
})()`);

events.length = 0;
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(18000);

// Did we still download the 53 MB CSV?
const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
const csvReqs = reqs.filter(u => /puzzles\.csv/.test(u));
console.log(`requests: ${reqs.length}, csv requests: ${csvReqs.length}`);
ok(csvReqs.length === 0, "NO /puzzles.csv request — the 53 MB payload is gone");

const apiReqs = reqs.filter(u => /\/api\/(puzzles|themes|openings|dispense)/.test(u));
console.log("api calls:", apiReqs.map(u => u.replace("http://localhost:3000","")).slice(0,8).join("\n            "));
ok(apiReqs.some(u => /\/api\/puzzles\?ids=/.test(u)), "hydrates the user's own puzzles via /api/puzzles?ids=");
ok(apiReqs.some(u => /\/api\/themes/.test(u)), "theme counts come from /api/themes");
ok(apiReqs.some(u => /\/api\/openings/.test(u)), "opening counts come from /api/openings");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
const consoleErrs = events.filter(e => e.method === "Runtime.consoleAPICalled" && e.params.type === "error");
console.log(`exceptions: ${errs.length}, console errors: ${consoleErrs.length}`);
errs.slice(0,4).forEach(e => console.log("   !", (e.params.exceptionDetails.exception?.description ?? "").slice(0,220)));
consoleErrs.slice(0,4).forEach(e => console.log("   c!", (e.params.args?.[0]?.value ?? "").toString().slice(0,220)));
ok(errs.length === 0, "no uncaught exceptions");

// UI state
const ui = await evalJs(`(() => {
  const txt = document.body.innerText;
  return {
    loaded: !/Loading/i.test(document.querySelector('main')?.innerText?.slice(0,200) ?? 'Loading'),
    bodyLen: txt.length,
    hasCatalogSize: /catalog|puzzle/i.test(txt),
    themeCountSample: txt.match(/([\\d,]+)\\s+puzzles/g)?.slice(0,4) ?? [],
    reviewTab: [...document.querySelectorAll('nav button')].map(b=>b.innerText.trim()).join(' | '),
    dueLine: (document.body.innerText.match(/[\\d,]+\\s+puzzles? due for review/) ?? [])[0] ?? null,
    errorText: /Application error|Unhandled|Cannot read/i.test(txt),
  };
})()`);
console.log(JSON.stringify(ui, null, 1));
ok(!ui.errorText, "no error boundary / crash text on page");
// NOTE: the Training tab is the minimal quick-start view, so "N puzzles" there is
// the DUE COUNT, not a theme count. Catalogue-scale counts are asserted in
// cdp-verify-allthemes.mjs (the All themes tab), which is the right place for it.
ok(ui.dueLine !== null, `due count renders (${ui.dueLine})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
