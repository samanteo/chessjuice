/**
 * GLOBAL PROGRESS BAR — "0 / 150" for three blocks of 50.
 *
 * The claims this test exists to hold:
 *   1. The bar sums EVERY block's total (3 x 10 themes x 5 = 150).
 *   2. A block's contribution is its FIRST-RUN credit: finishing a block twice
 *      does NOT add twice.
 *   3. Restarting a finished block does NOT empty the bar — the earned credit is
 *      banked, so the user keeps the progress they already did.
 *   4. Editing a block's themes (add / remove) moves the DENOMINATOR only; earned
 *      credit is never silently dropped.
 *   5. Removing a round the user has already passed shifts the position back, so
 *      they stay on the same round instead of skipping one.
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

const bar = () => ev(`(() => {
  const el = document.querySelector('[data-testid="global-progress"]');
  if (!el) return null;
  const fill = el.querySelector('.pixel-bar__fill');
  const track = el.querySelector('.pixel-bar');
  return {
    label: el.querySelector('[data-testid="global-progress-label"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
    done: Number(el.getAttribute('data-done')),
    total: Number(el.getAttribute('data-total')),
    fillPct: fill ? Math.round((fill.getBoundingClientRect().width / Math.max(1, track.getBoundingClientRect().width)) * 100) : null,
    role: track?.getAttribute('role') ?? null,
    now: track?.getAttribute('aria-valuenow') ?? null,
    max: track?.getAttribute('aria-valuemax') ?? null,
  };
})()`);
const stored = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('puzzle_trainer_blocks')); } catch { return null; } })()`);
const blockOf = async (bid) => (await stored())?.blocks?.find((b) => b.id === bid) ?? null;
const go = async () => {
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(4200);
};
const expected = async () => {
  const s = await stored();
  const per = 5;
  let total = 0, done = 0;
  for (const b of s.blocks) {
    const t = b.themes.length * per;
    total += t;
    done += Math.min(b.credit.themeIndex * per + b.credit.done, t);
  }
  return { total, done, label: done + " / " + total };
};
const setBlocks = async (patch) => ev(`(() => {
  const s = JSON.parse(localStorage.getItem('puzzle_trainer_blocks'));
  ${patch}
  localStorage.setItem('puzzle_trainer_blocks', JSON.stringify(s));
  return true;
})()`);

await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- seed: 3 blocks x 10 themes, 5 puzzles per theme = 150 -------------------
const THEMES = ["fork", "pin", "skewer", "mate", "hanging", "defense", "discovered", "trapped", "equality", "advantage"];
const seed = (themeIndex = 0, done = 0, credit = { themeIndex: 0, done: 0 }) => JSON.stringify({
  selected: "b0",
  blocks: [0, 1, 2].map((i) => ({
    id: "b" + i, name: "Block " + (i + 1), themes: THEMES,
    themeIndex, done, credit,
  })),
});
await ev(`localStorage.clear();
  localStorage.setItem('puzzle_trainer_sync','off');
  localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ quickStartCount: 5 }));
  localStorage.setItem('puzzle_trainer_blocks', ${JSON.stringify(seed())});`);
await go();

// ---- 1. the bar sums all three blocks ---------------------------------------
const b0 = await bar();
console.log("  bar at zero:", JSON.stringify(b0));
ok(b0 !== null, "the global bar is rendered on the Training tab");
ok(b0?.label === "0 / 150", `it reads 0 / 150 for three blocks of 50 (${b0?.label})`);
ok(b0?.done === 0 && b0?.total === 150, `its data attributes agree (${b0?.done}/${b0?.total})`);
ok(b0?.fillPct === 0, `the fill is empty at zero (${b0?.fillPct}%)`);
ok(b0?.role === "progressbar" && b0?.max === "150", `it is a real progressbar (role=${b0?.role}, max=${b0?.max})`);

// ---- 2. mid-progress shows up ----------------------------------------------
await setBlocks(`const b = s.blocks[0]; b.themeIndex = 5; b.done = 2; b.credit = { themeIndex: 5, done: 2 };`);
await go();
const b1 = await bar();
// 5 themes x 5 + 2 = 27 of 150 = 18%
ok(b1?.label === "27 / 150", `mid-progress reads 27 / 150 (${b1?.label})`);
ok(b1?.fillPct >= 17 && b1?.fillPct <= 19, `the fill is about 18% (${b1?.fillPct}%)`);

// ---- 3. a finished block contributes its whole 50 ---------------------------
await setBlocks(`const b = s.blocks[0]; b.themeIndex = 10; b.done = 0; b.credit = { themeIndex: 10, done: 0 };`);
await go();
const b2 = await bar();
ok(b2?.label === "50 / 150", `a finished block contributes all 50 (${b2?.label})`);

// ---- 4. RESTART does not empty the bar --------------------------------------
// This is the whole point of banking credit: the block goes back to puzzle 1,
// but the global bar keeps the 50 already earned.
await ev(`document.querySelector('[data-testid="block-select-b0"]')?.click()`);
await sleep(700);
// A COMPLETE block restarts through the primary button — the armed "↺ Restart"
// only renders while a block is part-finished, so clicking it here would be a
// no-op (and once was: this test caught its own mistake).
const primaryLabel = await ev(`document.querySelector('[data-testid="quickstart-button"]')?.innerText?.trim()`);
ok(/Restart/i.test(primaryLabel ?? ""), `a finished block offers Restart as its primary action (${primaryLabel})`);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(1200);
const afterRestart = await bar();
const restartedBlock = await blockOf("b0");
console.log("  block after restart:", JSON.stringify(restartedBlock));
ok(restartedBlock?.themeIndex === 0 && restartedBlock?.done === 0, "the block itself went back to its first puzzle");
ok(afterRestart?.label === "50 / 150", `the global bar KEEPS the earned 50 after a restart (${afterRestart?.label})`);
ok(restartedBlock?.credit?.themeIndex === 10, "the credit is still banked on the block");

// ---- 5. finishing it a second time does NOT add twice -----------------------
await setBlocks(`const b = s.blocks[0]; b.themeIndex = 10; b.done = 0; b.credit = { themeIndex: 10, done: 0 };`);
await go();
const b3 = await bar();
ok(b3?.label === "50 / 150", `finishing the same block twice still counts 50, not 100 (${b3?.label})`);

// ---- 6. adding a theme moves the denominator only ---------------------------
await ev(`document.querySelector('[data-testid="add-theme"]')?.click()`);
await sleep(700);
// Pick a theme that is NOT already a round — clicking an existing one is a
// toggle/no-op, so the test would silently add nothing.
const added = await ev(`(() => {
  const have = new Set(${JSON.stringify(THEMES)});
  const row = [...document.querySelectorAll('[data-testid^="picker-row-"]')]
    .find((e) => !have.has(e.getAttribute('data-testid').replace('picker-row-','')));
  if (!row) return null;
  const id = row.getAttribute('data-testid').replace('picker-row-','');
  row.click();
  return id;
})()`);
await sleep(800);
await ev(`document.querySelector('[data-testid="picker-close"]')?.click()`);
await sleep(900);
const afterAdd = await bar();
const bAfterAdd = await blockOf("b0");
const expAdd = await expected();
console.log("  added theme:", added, "| rounds:", bAfterAdd?.themes?.length);
ok(!!added, `a theme outside the block was available to add (${added})`);
ok(bAfterAdd?.themes?.length === 11, `the block now has 11 rounds (${bAfterAdd?.themes?.length})`);
ok(afterAdd?.label === expAdd.label, `adding a theme raises the total and keeps the earned credit (${afterAdd?.label} vs ${expAdd.label})`);
ok(afterAdd?.total === 155, `the total went from 150 to 155 (${afterAdd?.total})`);
ok(afterAdd?.done === 50, `the earned 50 was NOT dropped (${afterAdd?.done})`);

// ---- 7. removing a theme keeps the earned credit ---------------------------
await ev(`document.querySelector('[data-testid="unpin-${added}"]')?.click()`);
await sleep(900);
const afterRemove = await bar();
const bAfterRemove = await blockOf("b0");
const expRemove = await expected();
ok(bAfterRemove?.themes?.length === 10, `the round was removed again (${bAfterRemove?.themes?.length})`);
ok(afterRemove?.label === expRemove.label, `removing a round lowers the total and keeps the earned credit (${afterRemove?.label} vs ${expRemove.label})`);
ok(afterRemove?.total === 150, `the total went back to 150 (${afterRemove?.total})`);

// ---- 8. removing a PASSED round does not skip the next one -----------------
// Block 1 sits on round 4 (index 3). Removing round 1 (index 0) must leave it on
// the SAME round, i.e. the index drops to 2.
await setBlocks(`const b = s.blocks[1]; b.themeIndex = 3; b.done = 1; b.credit = { themeIndex: 3, done: 1 };`);
await go();
await ev(`document.querySelector('[data-testid="block-select-b1"]')?.click()`);
await sleep(700);
await ev(`document.querySelector('[data-testid="unpin-fork"]')?.click()`);
await sleep(900);
const shifted = await blockOf("b1");
console.log("  block 1 after removing a passed round:", JSON.stringify(shifted));
ok(shifted?.themeIndex === 2, `the position shifted back by one so the same round stays on the board (${shifted?.themeIndex})`);
ok(shifted?.done === 1, "the puzzles done inside that round are preserved");
const b4 = await bar();
const expShift = await expected();
console.log("  expected after shift:", JSON.stringify(expShift));
ok(b4?.label === expShift.label, `the bar counts the shifted block's banked credit (${b4?.label})`);

// ---- 9. deleting a block drops its contribution ----------------------------
await ev(`document.querySelector('[data-testid="block-select-b2"]')?.click()`);
await sleep(700);
await ev(`document.querySelector('[data-testid="block-delete"]')?.click()`);
await sleep(400);
await ev(`document.querySelector('[data-testid="block-delete"]')?.click()`);
await sleep(900);
const b5 = await bar();
const b5s = await stored();
const expDelete = await expected();
ok(b5s?.blocks?.length === 2, `the block was deleted (${b5s?.blocks?.length} left)`);
ok(b5?.label === expDelete.label, `its puzzles left the total with it (${b5?.label} vs ${expDelete.label})`);
ok(b5?.total === 95, `the total dropped by exactly the deleted block's 50 (${b5?.total})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
