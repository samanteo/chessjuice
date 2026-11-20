/**
 * Verify the Lichess-style SESSION history in the live app:
 *  - rounds group into sessions by ANGLE with the 1h rule
 *  - the opening-angle filter exists and filters
 *  - session headers show the angle label + counts
 *  - no horizontal overflow
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

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

console.log("navigating…");
// --- HARNESS ISOLATION GUARD: opt out of sync BEFORE the app boots -----------
// `Page.addScriptToEvaluateOnNewDocument` runs in the new document BEFORE any
// page script, so `puzzle_trainer_sync==='off'` is in place before
// installStateSync() runs. The app then neither PULLS from nor PUSHES to the
// user's real /api/state store. Setting the flag AFTER the first load is too
// late — the app has already booted and may already have pushed (that is how a
// fake quickStartCount/rating leaked into the user's real state).
// ONE mechanism, identical in every harness in this directory.
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}",
});
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

// Seed a history that MUST produce a known session structure.
// Angles: sicilianDefense x3 (10 min apart) -> 1 session
//         mix x2 (5 min apart, +30 min later) -> 1 session
//         italianGame x1 (+2h later) -> 1 session
//         sicilianDefense x2 (3h later, 20 min apart) -> 1 session
// => 4 sessions, 8 rounds
const now = Date.now();
const MIN = 60_000;
const plan = [
  ["sicilianDefense", 0, 0], ["sicilianDefense", 1, 10], ["sicilianDefense", 2, 20],
  ["mix", 3, 50], ["mix", 4, 55],
  ["italianGame", 5, 175],
  ["sicilianDefense", 6, 355], ["sicilianDefense", 7, 375],
];
const attempts = plan.map(([angle, i, minsAgo]) => ({
  puzzleId: `seed${i}`, userId: "local",
  result: i % 2 === 0 ? "correct" : "incorrect",
  moveNumber: 1, timeSpent: 4000, hintUsed: false, solutionViewed: false,
  ratingBefore: 1500, ratingAfter: 1500,
  timestamp: new Date(now - minsAgo * MIN).toISOString(),
  puzzleRating: 1500,
  themes: ["fork"],
  openings: angle === "mix" ? [] : [angle],
  angle,
}));
await evalJs(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(attempts))})`);
await evalJs(`localStorage.removeItem('puzzle_trainer_progress_v2')`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(8000);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e => console.log("   !", (e.params.exceptionDetails.exception?.description ?? "").slice(0,200)));

// sessions render
const s = await evalJs(`(() => {
  const panel = document.querySelector('[data-testid="history-all-panel"]');
  if (!panel) return { present:false };
  const lis = [...panel.querySelectorAll('li')];
  return {
    present: true,
    sessions: lis.length,
    header: panel.querySelector('p')?.innerText ?? null,
    labels: lis.map(li => li.querySelector('span')?.innerText ?? '').slice(0,6),
    roundChips: lis.map(li => li.querySelectorAll('button[title*="replay"]').length),
    angleFilter: !!document.querySelector('[data-testid="history-all-angle"]'),
    angleOptions: [...(document.querySelector('[data-testid="history-all-angle"]')?.options ?? [])].map(o=>o.text).slice(0,8),
  };
})()`);
console.log(JSON.stringify(s, null, 1));
ok(s.present, "history panel renders");
ok(s.sessions === 4, `grouped into exactly 4 sessions (${s.sessions})`);
// Newest-first display: Sicilian(3) · Mixed(2) · Italian(1) · Sicilian(2).
// (The previous expectation [2,1,2,3] was written oldest-first — my error.)
ok(JSON.stringify(s.roundChips) === JSON.stringify([3,2,1,2]), `round counts per session [3,2,1,2] (${JSON.stringify(s.roundChips)})`);
ok(s.angleFilter, "opening-angle filter exists");
ok(s.angleOptions.some(t => /Sicilian Defense/.test(t)), `angle options are labelled (${s.angleOptions.join(" | ")})`);
ok(!s.angleOptions.some(t => /^mix$/i.test(t)), "'mix' is not offered as an opening");

// the angle filter actually filters
const before = await evalJs(`Number(document.querySelector('[data-testid="history-all-replay"]')?.dataset.count ?? -1)`);
await evalJs(`(() => { const sel=document.querySelector('[data-testid="history-all-angle"]'); sel.value='sicilianDefense'; sel.dispatchEvent(new Event('change',{bubbles:true})); })()`);
await sleep(900);
const after = await evalJs(`(() => {
  const panel = document.querySelector('[data-testid="history-all-panel"]');
  return {
    queue: Number(document.querySelector('[data-testid="history-all-replay"]')?.dataset.count ?? -1),
    sessions: panel.querySelectorAll('li').length,
    header: panel.querySelector('p')?.innerText ?? null,
  };
})()`);
console.log(`angle filter: queue ${before} -> ${after.queue}, sessions ${after.sessions}, header "${after.header}"`);
ok(after.queue < before, `angle filter narrows the replay queue (${before} -> ${after.queue})`);
ok(after.queue === 5, `sicilianDefense matches 5 rounds (${after.queue})`);
ok(after.sessions === 2, `and 2 sessions (${after.sessions})`);

// no overflow
const of = await evalJs(`(() => {
  const bad=[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+8&&e.clientWidth>60);
  return {
    count: bad.length,
    body: document.body.scrollWidth, win: window.innerWidth,
    detail: bad.slice(0,5).map(e=>({
      tag: e.tagName.toLowerCase(),
      tid: e.getAttribute('data-testid') || '',
      cls: (e.className||'').toString().slice(0,60),
      sw: e.scrollWidth, cw: e.clientWidth,
      txt: (e.innerText||'').replace(/\\n/g,' ').slice(0,40),
    })),
  };
})()`);
console.log(`overflow: ${JSON.stringify(of)}`);
ok(of.body <= of.win + 1, "no sideways page scroll");
ok(of.count === 0, `no element overflows its container (${of.count})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
