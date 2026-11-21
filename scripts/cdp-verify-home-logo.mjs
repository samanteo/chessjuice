/**
 * Regression: tapping the "Puzzle Trainer" branding is HOME.
 *
 * From ANY tab, with a puzzle on the board, one tap on the logo must:
 *   1. end the puzzle (the board disappears — its timers go with it)
 *   2. land on a PRISTINE Training tab: no board, no active theme
 *   3. leave no uncaught errors behind
 *
 * Covers both places a board can live: started from Training, and started
 * from inside the All themes tab (where the board renders in that tab).
 */
import { WebSocket } from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 23 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const d = JSON.parse(raw.toString()); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

// Collect uncaught page errors for the whole run.
const errs = [];
ws.on("message", (raw) => {
  const d = JSON.parse(raw.toString());
  if (d.method === "Runtime.exceptionThrown") {
    errs.push(d.params?.exceptionDetails?.exception?.description || "unknown");
  }
});

const state = () => ev(`(() => {
  const board = !!document.querySelector('[data-testid="board-stage"]');
  const allBoard = !!document.querySelector('[data-testid="allthemes-board"]');
  const trainingHome = !!document.querySelector('[data-testid="pinned-grid"]') || !!document.querySelector('[data-testid="quickstart-button"]');
  const logo = !!document.querySelector('[data-testid="home-logo"]');
  return { board, allBoard, trainingHome, logo };
})()`);
const clickTab = (label) => ev(`(() => {
  const b = [...document.querySelectorAll('nav button')].find(x => new RegExp(${JSON.stringify(label)}, 'i').test(x.innerText));
  if (b) { b.click(); return true; } return false;
})()`);
const clickLogo = () => ev(`(() => { const b = document.querySelector('[data-testid="home-logo"]'); if (b) { b.click(); return true; } return false; })()`);

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(3500);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]));`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(4500);

const s0 = await state();
ok(s0.logo, "the branding is a clickable home control (data-testid=home-logo)");
ok(!s0.board, "no board before we start");

// ---- Scenario A: puzzle started from Training ------------------------------
const started = await ev(`(() => { const b = document.querySelector('[data-testid="quickstart-button"]'); if (b) { b.click(); return true; } return false; })()`);
ok(started, "started a puzzle from the Training tab");
await sleep(4000);
const a1 = await state();
ok(a1.board, "the board is up on the Training tab");

const clickedFromTraining = await clickLogo();
ok(clickedFromTraining, "tapped the logo while a Training puzzle was running");
await sleep(1500);
const a2 = await state();
ok(!a2.board, "the puzzle was stopped — board is gone");
ok(a2.trainingHome, "landed on the Training tab (its home surface is showing)");
ok(!(await ev(`!!document.querySelector('[data-testid="active-theme"]')`)), "no theme is left armed");

// ---- Scenario B: puzzle started from inside the All themes tab -------------
const onAllThemes = await clickTab("All themes");
ok(onAllThemes, "switched to the All themes tab");
await sleep(2500);

// Expand the first theme category, then start its first theme.
await ev(`(() => {
  const btns = [...document.querySelectorAll('main button')].filter(b => /puzzles/i.test(b.innerText));
  const header = btns.find(b => b.querySelector('h3'));
  if (header) header.click();
})()`);
await sleep(1800);
const startedAll = await ev(`(() => {
  const btns = [...document.querySelectorAll('main button')].filter(b => /^\\s*\\S+\\s+\\S/.test(b.innerText) && !/puzzles\\s*$/i.test(b.innerText));
  const theme = btns.find(b => b.querySelector('h4') && !b.disabled);
  if (theme) { theme.click(); return theme.querySelector('h4').innerText; }
  return null;
})()`);
ok(!!startedAll, `started a puzzle inside All themes (${startedAll})`);
await sleep(4500);
const b1 = await state();
ok(b1.allBoard || b1.board, "a board is up inside the All themes tab");

const clickedFromAll = await clickLogo();
ok(clickedFromAll, "tapped the logo while an All themes puzzle was running");
await sleep(1500);
const b2 = await state();
ok(!b2.allBoard && !b2.board, "the All themes board was stopped too");
ok(b2.trainingHome, "and we are on the Training tab, not left in All themes");

ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
