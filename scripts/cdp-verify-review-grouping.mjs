/**
 * Verify the Review tab's "Group by theme" — and that it KEEPS GROUPING while
 * you play.
 *
 * History: the toggle used to regroup the LIST only (by opening/"angle", which
 * put ~all puzzles in one "Mixed" bucket), and "Next puzzle" ignored it
 * entirely — so the very next puzzle could be a different theme. This test
 * pins the fixed behaviour:
 *   1. off by default, flat list
 *   2. on  -> grouped by MOTIF theme, more than one group, no items lost
 *   3. the choice survives a reload (persisted)
 *   4. "Get Next Puzzle" serves a puzzle from the top group
 *   5. skipping forward stays inside the same group until it runs out
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const page = list.find((t) => t.type === "page" && /localhost:3000/.test(t.url)) || list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// HARNESS ISOLATION: never touch the user's real state.
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });

// Pick seed puzzles by MOTIF so the grouping is deterministic: 3 forks + 2 hung pieces.
const NON_MOTIF = new Set(["crushing","advantage","equality","opening","middlegame","endgame","master","masterVsMaster","superGM"]);
const groupOf = (p) => (p.themes || []).find((t) => !NON_MOTIF.has(t)) || (p.themes || [])[0] || "mix";
const pick = async (theme, n) => {
  const r = await fetch(`http://localhost:3000/api/puzzles?themes=${theme}&limit=60`);
  const rows = await r.json();
  return rows.filter((p) => groupOf(p) === theme).slice(0, n);
};
const seeds = [...(await pick("fork", 3)), ...(await pick("hangingPiece", 2))];
if (seeds.length < 4) { console.log("not enough seed puzzles", seeds.length); process.exit(1); }
const groups = seeds.map(groupOf);
console.log("seeded:", seeds.map((p, i) => `${p.id}:${groups[i]}`).join(" "));

// Progress-entry shape the app actually reads (applyProgress): `wr` marks the
// puzzle as a wrong/mistake puzzle, `due` makes it due, `rg` is the ladder rung.
const now = Date.now();
const progress = {};
for (const p of seeds) {
  progress[p.id] = {
    rg: 0, wr: 1, at: 1, co: 0,
    due: new Date(now - 60000).toISOString(),
    lr: new Date(now - 3600000).toISOString(),
    iw: 1,
  };
}
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(12000);
await ev(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(progress))})`);
await ev(`localStorage.setItem('puzzle_trainer_group_by_theme','0')`);
// MOTIF TAGS MUST BE VISIBLE for this test: it identifies the group of the
// served puzzle by reading the board head's theme chips, and those are hidden
// while the TAGS switch is off (its default). Without this the read is `null`
// and every grouping assertion fails on a UI setting, not on the behaviour.
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ showTags: true }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`(()=>{const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText));b&&b.click()})()`);
await sleep(4000);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.log("  FAIL", msg); } };

const read = () => ev(`(()=>{
  const main=document.querySelector('main');
  const toggle=document.querySelector('[data-testid="queue-group-toggle"]');
  const grouped=document.querySelector('[data-testid="queue-grouped"]');
  const items=[...main.querySelectorAll('[data-testid^="queue-item-"]')].map(e=>e.getAttribute('data-testid'));
  const grps=[...document.querySelectorAll('[data-testid^="queue-group-"]')]
    .filter(e=>e.getAttribute('data-testid')!=='queue-group-toggle')
    .map(e=>({key:e.getAttribute('data-testid').replace('queue-group-',''),label:(e.querySelector('span')||{}).innerText||'',n:e.querySelectorAll('[data-testid^="queue-item-"]').length}));
  return {on:toggle&&toggle.getAttribute('data-on'),grouped:!!grouped,items,grps};
})()`);

const off = await read();
ok(off.on === "0", "toggle is off by default");
ok(!off.grouped, "flat list when grouping is off");
ok(off.items.length >= seeds.length, `seeded puzzles appear in the queue (${off.items.length})`);

await ev(`document.querySelector('[data-testid="queue-group-toggle"]').click()`);
await sleep(1200);
const on = await read();
console.log("  groups:", JSON.stringify(on.grps));
ok(on.on === "1", "toggle flips on");
ok(on.grouped, "grouped view renders");
ok(on.grps.length >= 2, `more than one theme group (${on.grps.length})`);
ok(on.grps.some(g => g.key === "fork"), "a fork group exists");
ok(on.grps.some(g => g.key === "hangingPiece"), "a hangingPiece group exists");
ok(!on.grps.some(g => /Mixed/i.test(g.label)), "no useless 'Mixed' bucket");
ok(on.items.length === off.items.length, `no items lost by grouping (${on.items.length})`);

// Persistence across reload.
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`(()=>{const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText));b&&b.click()})()`);
await sleep(4000);
const after = await read();
ok(after.on === "1", "grouping survives a reload");
ok(after.grouped, "still grouped after reload");

// Play: Get Next Puzzle must serve the TOP group, and skipping must stay there.
const topGroup = after.grps[0]?.key;
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Get Next Puzzle/i.test(x.innerText));b&&b.click()})()`);
await sleep(4000);
const served = () => ev(`(()=>{
  const t=document.querySelector('[data-testid="puzzle-themes"]');
  const stage=document.querySelector('[data-testid="board-stage"]');
  return {themes:t?[...t.querySelectorAll('span')].map(s=>s.innerText.trim()):null, fen:stage?stage.getAttribute('data-fen'):null,
          skip:!!document.querySelector('[data-testid="skip-button"]'), next:!!document.querySelector('[data-testid="next-button"]')};
})()`);
const g1 = await served();
console.log("  served:", JSON.stringify({ themes: g1.themes, skip: g1.skip }));
const inTop = (themes) => (themes || []).some((t) => t.toLowerCase() === String(topGroup).toLowerCase());
ok(!!g1.fen, "a puzzle opened on the board");
ok(inTop(g1.themes), `first served puzzle is in the top group (${topGroup})`);

// Skip advances (two-tap: arm, then confirm).
const skipOnce = async () => {
  await ev(`(()=>{const b=document.querySelector('[data-testid="skip-button"]');b&&b.click()})()`);
  await sleep(700);
  await ev(`(()=>{const b=document.querySelector('[data-testid="skip-button"]');b&&b.click()})()`);
  await sleep(3500);
};
await skipOnce();
const g2 = await served();
console.log("  after skip 1:", JSON.stringify({ themes: g2.themes }));
ok(!!g2.fen, "skip served another puzzle");
ok(inTop(g2.themes), `2nd puzzle still in the same group (${topGroup})`);
await skipOnce();
const g3 = await served();
console.log("  after skip 2:", JSON.stringify({ themes: g3.themes }));
ok(!!g3.fen, "skip served a third puzzle");
ok(inTop(g3.themes), `3rd puzzle still in the same group (${topGroup})`);

const errs = await ev(`window.__errs ? window.__errs.length : 0`);
ok(!errs, `no uncaught exceptions (${errs})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
