/**
 * Verify the reported UI bugs against the LIVE app.
 *  1. tab renamed to Review
 *  2. the red "due for review" button actually navigates
 *  3. review-list formatting: no horizontal overflow anywhere
 *  4. the mobile tab bar fits in 390px
 */
import { WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";

const CDP = "http://localhost:9245";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.resolve(import.meta.dirname, "..");

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
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
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send("Runtime.enable"); await send("Page.enable");
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
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(15000);

// seed a DUE mistake so the red button renders (rung 0 == today's deck == due)
// (pool comes from the API — the CSV is gone)
const picked = [];
{
  const res = await fetch("http://localhost:3000/api/puzzles?themes=fork&limit=100");
  const rows = await res.json();
  for (const r of rows.slice(0, 4)) {
    picked.push({ id: r.id, rating: r.rating, themes: r.themes });
  }
}
const progress = {};
for (const p of picked) {
  progress[p.id] = {
    rg: 0,                                   // rung 0 -> due NOW
    due: new Date(Date.now() - 60_000).toISOString(),
    wr: 1, at: 1, co: 0,                     // wrong puzzle
  };
}
await evalJs(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(progress))})`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(15000);

const errs0 = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs0.length === 0, `no uncaught exceptions on load (${errs0.length})`);

// ---- 1. tab renamed ----
const tabs = await evalJs(`Array.from(document.querySelectorAll('nav button')).map(b=>b.innerText.trim()).filter(Boolean)`);
const tabText = tabs.join("|");
console.log(`tabs: ${JSON.stringify(tabs.slice(0, 8))}`);
ok(/Review/.test(tabText), "the tab is now labelled 'Review'");
ok(!/Mistakes/.test(tabText), "no tab still says 'Mistakes'");

// ---- 4. mobile tab bar fits ----
const navFit = await evalJs(`(() => {
  const nav = document.querySelector('nav.md\\\\:hidden') || document.querySelector('nav');
  const r = nav.getBoundingClientRect();
  return { sw: nav.scrollWidth, cw: nav.clientWidth, w: Math.round(r.width),
           bodyScrollW: document.body.scrollWidth, winW: window.innerWidth };
})()`);
console.log(`mobile nav: ${JSON.stringify(navFit)}`);
ok(navFit.sw <= navFit.cw + 1, `mobile tab bar no longer overflows (${navFit.sw} <= ${navFit.cw})`);
ok(navFit.bodyScrollW <= navFit.winW + 1, `page does not scroll sideways (${navFit.bodyScrollW} <= ${navFit.winW})`);

// ---- 2. the due button ----
const dueBtn = await evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>/due for review/i.test(x.innerText));
  if(!b) return { present:false, bodyHas:/due for review/i.test(document.body.innerText) };
  const r=b.getBoundingClientRect();
  return { present:true, text:b.innerText.trim(), w:Math.round(r.width), h:Math.round(r.height),
           inViewport: r.top >= 0 && r.top < window.innerHeight };
})()`);
console.log(`due button: ${JSON.stringify(dueBtn)}`);
ok(dueBtn.present, "the red due button renders when puzzles are due");

if (dueBtn.present) {
  await evalJs(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/due for review/i.test(x.innerText));
    b.scrollIntoView({block:'center'}); b.click();
  })()`);
  await sleep(3500);
  const after = await evalJs(`({
    body: document.body.innerText.slice(0,200).replace(/\\n+/g,' | '),
    onReview: !document.querySelector('[data-testid="quickstart-button"]'),
    queueTabs: [...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(t=>/Due|Learning|Mastered|Archived/i.test(t)).slice(0,6),
  })`);
  console.log(`after click: ${JSON.stringify(after, null, 1)}`);
  ok(after.onReview, "clicking the due button navigates away from Training");
}

// ---- 3. no horizontal overflow inside the review tab ----
const overflow = await evalJs(`(() => {
  const bad = [...document.querySelectorAll('*')]
    .filter(e => e.scrollWidth > e.clientWidth + 8 && e.clientWidth > 60)
    .map(e => ({ cls: (e.className||'').toString().slice(0,80), sw: e.scrollWidth, cw: e.clientWidth }));
  return { count: bad.length, bad: bad.slice(0,6), bodyScrollW: document.body.scrollWidth, winW: window.innerWidth };
})()`);
console.log(`overflowers: ${JSON.stringify(overflow, null, 1)}`);
ok(overflow.bodyScrollW <= overflow.winW + 1, `review tab does not scroll sideways (${overflow.bodyScrollW} <= ${overflow.winW})`);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
console.log(`\nuncaught exceptions total: ${errs.length}`);
errs.slice(0, 4).forEach((e) => console.log("   !", (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0, 220)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
