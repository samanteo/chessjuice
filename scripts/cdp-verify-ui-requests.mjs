/**
 * Verify the requested UI changes:
 *  1. tab renamed Appearance -> Settings
 *  2. Settings holds the Quick start count + Sound controls
 *  3. Training header is a RED Quick start button (no "Quick start" title)
 *  4. Quick start runs the pinned themes with a counter, auto-advancing
 *  5. the Add-theme picker offers OPENINGS
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

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear()`);
// Keep this test's clean-slate assumption: cross-device sync would otherwise
// re-import server state from an earlier run and break assertions like
// `attempts === 0` that have nothing to do with what is being tested.
await ev(`localStorage.setItem('puzzle_trainer_sync','off');`);
// Pin two themes so a Quick start run has something to walk.
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork","pin"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// 1. tabs
const tabs = await ev(`[...document.querySelectorAll('nav button')].map(b=>b.innerText.replace(/\\n/g,' ').trim())`);
console.log("tabs:", JSON.stringify(tabs));
ok(tabs.some(t => /Settings/.test(t)), "tab renamed to Settings");
ok(!tabs.some(t => /Appearance/.test(t)), "'Appearance' is gone");

// 3. red quick start button, no 'Quick start' h1
const train = await ev(`(() => {
  const main = document.querySelector('main');
  const h1 = main.querySelector('h1')?.innerText ?? null;
  const btn = document.querySelector('[data-testid="quickstart-button"]');
  return {
    h1,
    hasBtn: !!btn,
    btnText: btn?.innerText ?? null,
    bg: btn ? getComputedStyle(btn).backgroundColor : null,
    status: document.querySelector('[data-testid="quickrun-status"]') ? 'running' : 'idle',
  };
})()`);
console.log("training header:", JSON.stringify(train));
ok(train.hasBtn, "red Quick start button present");
ok(train.h1 === null, `no 'Quick start' <h1> title (h1 = ${train.h1})`);
const rgb = (train.bg ?? "").match(/(\d+),\s*(\d+),\s*(\d+)/);
// Was red; the user asked for a darker traffic-light GREEN matching the
// Review Due button's weight/style.
const isGreen = rgb && Number(rgb[2]) > Number(rgb[1]) && Number(rgb[2]) > Number(rgb[3]);
ok(isGreen, `button is GREEN (${train.bg})`);
ok(rgb && Number(rgb[1]) < 60, `and a dark, contrasting green (${train.bg})`);
ok(train.status === 'idle', "no run active before starting");

// 4. start a run
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);
const run = await ev(`(() => ({
  status: !!document.querySelector('[data-testid="quickrun-status"]'),
  counter: document.querySelector('[data-testid="quickrun-counter"]')?.innerText ?? null,
  stop: !!document.querySelector('[data-testid="quickrun-stop"]'),
  puzzle: (document.querySelector('main').innerText.match(/Puzzle #([A-Za-z0-9]{5})/) ?? [])[1] ?? null,
  board: !!document.querySelector('cg-board'),
}))()`);
console.log("after start:", JSON.stringify(run));
ok(run.status, "run status shows while a run is active");
ok(/^\d+ \/ \d+$/.test(run.counter ?? ""), `counter shows 'n / N' (${run.counter})`);
ok(run.stop, "a Stop control is offered");
ok(run.puzzle && run.board, `a puzzle loaded for the run (${run.puzzle})`);

// counter must show the configured count (default 10)
ok(run.counter === "1 / 10", `counter uses the default 10 per theme (${run.counter})`);

// 2. settings tab contents
await clickText(/Settings/);
await sleep(2500);
const settings = await ev(`(() => ({
  quickstart: !!document.querySelector('[data-testid="settings-quickstart"]'),
  sound: !!document.querySelector('[data-testid="settings-sound"]'),
  counts: [...document.querySelectorAll('[data-testid^="quickstart-count-"]')].map(e=>e.getAttribute('data-testid').replace('quickstart-count-','')),
  onCount: document.querySelector('[data-testid^="quickstart-count-"][data-on="1"]')?.getAttribute('data-testid') ?? null,
  soundToggle: !!document.querySelector('[data-testid="sound-toggle"]'),
  volume: !!document.querySelector('[data-testid="sound-volume"]'),
}))()`);
console.log("settings:", JSON.stringify(settings));
ok(settings.quickstart, "Settings has the Quick start section");
ok(settings.sound, "Settings has the Sound section");
ok(settings.counts.length >= 4, `puzzle-count options offered (${settings.counts.join(", ")})`);
ok(settings.onCount === "quickstart-count-10", `default is 10 per theme (${settings.onCount})`);
ok(settings.soundToggle && settings.volume, "sound toggle + volume render");

// change the count and confirm it sticks
await ev(`document.querySelector('[data-testid="quickstart-count-20"]').click()`);
await sleep(1200);
const changed = await ev(`(() => ({
  on: document.querySelector('[data-testid^="quickstart-count-"][data-on="1"]')?.getAttribute('data-testid') ?? null,
  stored: JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').quickStartCount,
}))()`);
console.log("after choosing 20:", JSON.stringify(changed));
ok(changed.on === "quickstart-count-20" && changed.stored === 20, `count persists (stored ${changed.stored})`);

// 5. openings in the picker
await clickText(/Training/);
await sleep(2000);
await clickText(/Add theme/);
await sleep(2500);
const picker = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const txt = dlg.innerText;
  return {
    open: /Add theme|Theme/i.test(txt.slice(0,200)),
    mentionsOpenings: /opening/i.test(txt),
    sample: txt.split('\\n').filter(l=>/opening|sicilian|defense|gambit|lopez/i.test(l)).slice(0,8),
  };
})()`);
console.log("picker:", JSON.stringify(picker));
ok(picker.mentionsOpenings, "the Add-theme picker mentions Openings");
ok(picker.sample.length > 0, `opening entries visible (${picker.sample.slice(0,3).join(" | ")})`);

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
