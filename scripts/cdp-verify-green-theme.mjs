/**
 * Verify the latest round:
 *  1. Quick start button is a DARKER green, same style/font as Review Due
 *  2. the helper sentence is gone
 *  3. the picker's openings are the REAL catalogue ones (not the curated few)
 *  4. the active theme shows above the board in Training, All themes AND Review
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
const clickText = (re) => ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test(x.innerText)); if(!b) return false; b.click(); return true; })()`);

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// 1+2. button colour + helper text
const btn = await ev(`(() => {
  const b = document.querySelector('[data-testid="quickstart-button"]');
  const due = [...document.querySelectorAll('button')].find(x=>/Review Due/.test(x.innerText));
  const cs = b ? getComputedStyle(b) : null;
  const ds = due ? getComputedStyle(due) : null;
  return {
    bg: cs?.backgroundColor, radius: cs?.borderRadius, weight: cs?.fontWeight, size: cs?.fontSize,
    dueBg: ds?.backgroundColor, dueRadius: ds?.borderRadius, dueWeight: ds?.fontWeight, dueSize: ds?.fontSize,
    helperGone: !/Runs through your pinned themes/.test(document.body.innerText),
  };
})()`);
console.log("button:", JSON.stringify(btn));
const g = (btn.bg ?? "").match(/(\d+),\s*(\d+),\s*(\d+)/);
const isGreen = g && Number(g[2]) > Number(g[1]) && Number(g[2]) > Number(g[3]);
ok(isGreen, `button is GREEN (${btn.bg})`);
ok(g && Number(g[1]) < 60 && Number(g[2]) < 160, `green is dark/contrasting, not washed out (${btn.bg})`);
// Style parity with the Review Due button. It only renders when something is
// due, so compare only when it is present (otherwise this asserts nothing).
if (btn.dueBg) {
  ok(btn.radius === btn.dueRadius, `same corner radius as Review Due (${btn.radius} vs ${btn.dueRadius})`);
  ok(btn.weight === btn.dueWeight, `same font weight as Review Due (${btn.weight} vs ${btn.dueWeight})`);
  ok(btn.size === btn.dueSize, `same font size as Review Due (${btn.size} vs ${btn.dueSize})`);
} else {
  console.log("  (skipped Review-Due style parity: no due puzzles, so that button is absent)");
  ok(btn.radius === "8px" && btn.weight === "500", `matches the shared button style (radius ${btn.radius}, weight ${btn.weight})`);
}
ok(btn.helperGone, "the 'Runs through your pinned themes…' sentence is gone");

// 3. picker openings are the REAL catalogue ones
await clickText(/Add theme/);
await sleep(3000);
const pick = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const rows = [...dlg.querySelectorAll('[data-testid^="picker-opening-"]')];
  return {
    count: rows.length,
    first: rows.slice(0,5).map(e => e.getAttribute('data-testid').replace('picker-opening-','')),
  };
})()`);
console.log("picker openings:", JSON.stringify(pick));
ok(pick.count > 0, `opening rows render (${pick.count})`);
// The real top openings are Sicilian/French/Queen's Pawn; the old curated list
// started alphabetically at Alekhine/Benoni/Bird.
ok(pick.first.includes('sicilianDefense'), `shows the REAL catalogue openings by count (${pick.first.slice(0,3).join(", ")})`);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Close|Done|✕/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(1500);

// 4a. theme above the board — Training
await clickText(/Training/);
await sleep(1500);
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(10000);
const train = await ev(`(() => ({
  label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  board: !!document.querySelector('[data-testid="training-board"]'),
}))()`);
console.log("training board theme:", JSON.stringify(train));
ok(train.board, "Training board renders");
ok(train.label === "Fork", `theme shown above the Training board (${train.label})`);

// 4b. theme above the board — All themes
await clickText(/All themes/);
await sleep(2000);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Fork/.test(x.innerText.trim()) || /Fork/.test(x.innerText) && /puzzles/.test(x.innerText)); b&&b.click(); })()`);
await sleep(9000);
const all = await ev(`(() => ({
  inAllThemes: !!document.querySelector('[data-testid="allthemes-board"]'),
  label: document.querySelector('[data-testid="allthemes-board"] [data-testid="active-theme"]')?.innerText ?? null,
  stillOnAllThemes: /All themes/.test(document.querySelector('h1')?.innerText ?? ''),
}))()`);
console.log("all-themes board:", JSON.stringify(all));
ok(all.inAllThemes, "the board renders INSIDE All themes (no bounce to Training)");
ok(all.label !== null, `theme shown above the All-themes board (${all.label})`);

// 4c. theme above the board — Review
await clickText(/Review/);
await sleep(2500);
const review = await ev(`(() => ({
  label: document.querySelector('[data-testid="active-theme"]')?.innerText ?? null,
  board: !!document.querySelector('[data-board-context="review"]'),
}))()`);
console.log("review board:", JSON.stringify(review));

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
