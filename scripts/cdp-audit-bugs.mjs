/**
 * Audit all six reported bugs against the LIVE app (not the source).
 * Reports facts only — no fixes.
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

console.log("navigating…");
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(15000);

// seed a little history so panels have content
const csv = fs.readFileSync(path.join(ROOT, "public/puzzles.csv"), "utf8").split("\n");
const picked = [];
for (let i = 1; i < 500 && picked.length < 8; i++) {
  const c = csv[i].split(",");
  if (!c[0] || !c[4] || !c[4].includes("fork")) continue;
  picked.push({ id: c[0], rating: Number(c[3]), themes: c[4].split(" ") });
}
const now = Date.now();
const attempts = picked.map((p, i) => ({
  puzzleId: p.id, userId: "local", result: i % 2 === 0 ? "correct" : "incorrect",
  moveNumber: 1, timeSpent: 5000, hintUsed: false, solutionViewed: false,
  ratingBefore: 1500, ratingAfter: 1500,
  timestamp: new Date(now - i * 3600_000).toISOString(),
  puzzleRating: p.rating, themes: p.themes,
}));
await evalJs(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(attempts))})`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(15000);

const out = {};

// --- BUG 1: tab labels ---
out.tabs = await evalJs(`Array.from(document.querySelectorAll('nav button')).map(b=>b.innerText.trim()).filter(Boolean)`);
console.log(`\n[1] TAB LABELS: ${JSON.stringify(out.tabs)}`);

// --- BUG 2: the "review due" button ---
const dueBtn = await evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>/due for review|due/i.test(x.innerText) && /review/i.test(x.innerText));
  if(!b) return { present:false };
  const r=b.getBoundingClientRect();
  return { present:true, text:b.innerText.trim().slice(0,60), w:Math.round(r.width), h:Math.round(r.height),
           pointer:getComputedStyle(b).pointerEvents, disabled:b.disabled,
           overflow: getComputedStyle(b).overflow };
})()`);
console.log(`[2] DUE BUTTON: ${JSON.stringify(dueBtn)}`);

// --- BUG 4: analytics activity heatmap ---
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(7000);

const activity = await evalJs(`(() => {
  const nodes = [...document.querySelectorAll('*')].filter(e => /activity/i.test(e.textContent||'') && e.children.length < 6);
  const scrollables = [...document.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 8 && e.clientWidth > 100);
  const cg = [...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height}));
  return {
    activityNodeCount: nodes.length,
    activityText: nodes[0] ? nodes[0].textContent.trim().slice(0,60) : null,
    scrollables: scrollables.slice(0,4).map(e=>({cls:(e.className||'').toString().slice(0,60), sw:e.scrollWidth, cw:e.clientWidth})),
    canvases: cg,
    bodyScrollW: document.body.scrollWidth, winW: window.innerWidth,
  };
})()`);
console.log(`[4] ACTIVITY: ${JSON.stringify(activity, null, 1)}`);

// --- BUG 3: replay button + history panels ---
const panels = await evalJs(`({
  oldReplay: !!document.querySelector('[data-testid="to-replay"]'),
  anyToReplay: /\\bto replay\\b/i.test(document.body.innerText),
  historyPanels: !!document.querySelector('[data-testid="history-panels"]'),
  historyAll: !!document.querySelector('[data-testid="history-all-panel"]'),
  historyToday: !!document.querySelector('[data-testid="history-today-panel"]'),
  allTestIds: [...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')).filter(t=>/history|replay/.test(t)),
})`);
console.log(`[3] REPLAY/HISTORY: ${JSON.stringify(panels, null, 1)}`);

// --- BUG 5: mistakes-tab list formatting ---
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Mistakes|Review/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(4000);
const listFmt = await evalJs(`(() => {
  const li = document.querySelector('li, [role="row"]');
  const rows = [...document.querySelectorAll('li')].slice(0,3).map(e=>({
    text: e.innerText.replace(/\\n+/g,' | ').trim().slice(0,70),
    h: Math.round(e.getBoundingClientRect().height),
    overflow: e.scrollWidth > e.clientWidth + 4,
  }));
  const overflowers = [...document.querySelectorAll('*')].filter(e=>e.scrollWidth > e.clientWidth + 8 && e.clientWidth>80).slice(0,5)
    .map(e=>({cls:(e.className||'').toString().slice(0,70), sw:e.scrollWidth, cw:e.clientWidth}));
  return { rows, overflowers, bodyScrollW: document.body.scrollWidth, winW: window.innerWidth };
})()`);
console.log(`[5] MISTAKES LIST: ${JSON.stringify(listFmt, null, 1)}`);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
console.log(`\nuncaught exceptions: ${errs.length}`);
errs.slice(0, 5).forEach((e) => console.log("   !", (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0, 250)));

ws.close();
process.exit(0);
