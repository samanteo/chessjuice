/**
 * Training BLOCKS — up to three named blocks, each with its own themes and its
 * own progress.
 *
 * Covers the claims the feature rests on:
 *   1. MIGRATION — an existing user's legacy pinned list + run position becomes
 *      Block 1 instead of being lost, and the legacy keys are retired.
 *   2. THE CAP — a third block can be added, a fourth cannot.
 *   3. PER-BLOCK THEMES — editing one block's themes leaves the others alone.
 *   4. PER-BLOCK PROGRESS — finishing a puzzle advances ONLY the running block.
 *   5. PERSISTENCE — every block's position survives a reload.
 *   6. RENAME / RESTART / DELETE — each acts on one block only, and the
 *      destructive ones arm first.
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

/** Chips as the user sees them: name + progress + which is selected. */
const chips = () => ev(`(() => [...document.querySelectorAll('[data-testid^="block-chip-"]')].map(e => ({
  id: e.getAttribute('data-testid').replace('block-chip-',''),
  name: (e.querySelector('button')?.innerText || '').trim(),
  text: e.innerText.replace(/\\s+/g,' ').trim(),
  selected: e.getAttribute('data-selected'),
  complete: e.getAttribute('data-complete'),
})))()`);
const button = () => ev(`(() => { const b = document.querySelector('[data-testid="quickstart-button"]'); return b ? { label: b.innerText.trim(), disabled: b.disabled } : null; })()`);
const gridHeader = () => ev(`(() => { const h = document.querySelector('[data-testid="pinned-themes"] h2'); return h ? h.innerText.trim() : null; })()`);
const gridCount = () => ev(`document.querySelectorAll('[data-testid="pinned-themes"] [data-testid^="pinned-slot-"]').length`);
const storedBlocks = () => ev(`localStorage.getItem('puzzle_trainer_blocks')`);
const seg = (t) => (t || "").match(/(\d+)\s*\/\s*(\d+)/);

const go = async (url = "http://localhost:3000/") => {
  await send("Page.navigate", { url: url.includes("?") ? url : url + "?cb=" + Date.now() });
  await sleep(4500);
};

await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go();

// ---- 1. MIGRATION ---------------------------------------------------------
// The world before blocks: a pinned list and a part-finished run.
const legacyThemes = ["fork", "pin", "skewer"];
await ev(`localStorage.clear();
  localStorage.setItem('puzzle_trainer_sync','off');
  localStorage.setItem('puzzle_trainer_pinned_themes', ${JSON.stringify(JSON.stringify(legacyThemes))});
  localStorage.setItem('puzzle_trainer_quickrun', JSON.stringify({ themes: ${JSON.stringify(legacyThemes)}, themeIndex: 1, done: 2, count: 5, savedAt: Date.now() }));
  localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ quickStartCount: 5 }));`);
await go();

const c1 = await chips();
console.log("  chips after migration:", JSON.stringify(c1));
ok(c1.length === 1, `exactly one block was created from the old data (${c1.length})`);
ok(c1[0]?.name === "Block 1", `it is named "Block 1" (${c1[0]?.name})`);
const m = seg(c1[0]?.text);
// 3 themes x 5 = 15; the old run was on theme 2 with 2 done -> position 8.
ok(m && m[1] === "8" && m[2] === "15", `the old position carried over (${c1[0]?.text})`);
ok((await gridHeader() || "").includes("Block 1"), `the pinned grid names the block (${await gridHeader()})`);
ok(await ev(`localStorage.getItem('puzzle_trainer_pinned_themes') === null`), "the retired legacy pins key was cleared");
ok((await storedBlocks()) !== null, "the blocks key now holds the data");

// ---- 2. THE CAP -----------------------------------------------------------
await ev(`document.querySelector('[data-testid="block-new"]')?.click()`);
await sleep(900);
await ev(`document.querySelector('[data-testid="block-new"]')?.click()`);
await sleep(900);
let c2 = await chips();
ok(c2.length === 3, `three blocks exist (${c2.length})`);
ok(!(await ev(`!!document.querySelector('[data-testid="block-new"]')`)), "the '+ New' affordance is gone at the cap");

// ---- 3. RENAME (one block only) -------------------------------------------
const second = c2.find((c) => c.id !== c1[0].id);
await ev(`document.querySelector('[data-testid="block-select-${second.id}"]')?.click()`);
await sleep(800);
await ev(`document.querySelector('[data-testid="block-rename"]')?.click()`);
await sleep(400);
await ev(`(() => { const i = document.querySelector('[data-testid="block-rename-input"]');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, 'Endgames'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(300);
await ev(`document.querySelector('[data-testid="block-rename-input"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
await sleep(900);
const afterRename = await chips();
ok(afterRename.find((c) => c.id === second.id)?.name === "Endgames", "the selected block was renamed");
ok(afterRename.find((c) => c.id === c1[0].id)?.name === "Block 1", "the other block kept its name");

// ---- 4. PER-BLOCK THEMES --------------------------------------------------
ok((await gridHeader() || "").includes("Endgames"), `the grid shows the selected block (${await gridHeader()})`);
const emptyGrid = await gridCount();
ok(emptyGrid === 0, `the new block starts with no themes of its own (${emptyGrid})`);
// Give the new block one theme through the picker.
await ev(`document.querySelector('[data-testid="add-theme"]')?.click()`);
await sleep(1200);
await ev(`(() => { const s = document.querySelector('[data-testid="picker-search"]');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(s, 'bishop'); s.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(1200);
const picked = await ev(`(() => { const r = document.querySelector('[data-testid^="picker-row-"]'); if (!r) return null; const n = r.getAttribute('data-testid'); r.click(); return n; })()`);
ok(!!picked, `added a theme to the new block (${picked})`);
await sleep(900);
await ev(`document.querySelector('[data-testid="picker-close"]')?.click()`);
await sleep(1000);
ok((await gridCount()) === 1, "the new block now shows exactly its own theme");
// Switch back: the first block must still have its three.
await ev(`document.querySelector('[data-testid="block-select-${c1[0].id}"]')?.click()`);
await sleep(900);
ok((await gridCount()) === 3, `the first block still has its own 3 themes (${await gridCount()})`);

// ---- 5. PER-BLOCK PROGRESS ------------------------------------------------
// Re-seed two blocks with DIFFERENT positions so the comparison is exact.
const b1 = "blk_test_a", b2 = "blk_test_b";
await ev(`localStorage.setItem('puzzle_trainer_blocks', JSON.stringify({ selected: '${b1}', blocks: [
  { id: '${b1}', name: 'Fork + Pin', themes: ['fork','pin'], themeIndex: 0, done: 3 },
  { id: '${b2}', name: 'Endgames', themes: ['bishopEndgame'], themeIndex: 0, done: 0 }
]}))`);
await go();
let c3 = await chips();
const p1 = seg(c3.find((c) => c.id === b1)?.text);
const p2 = seg(c3.find((c) => c.id === b2)?.text);
ok(p1 && p1[1] === "4" && p1[2] === "10", `block A reads 4/10 (${c3.find((c) => c.id === b1)?.text})`);
ok(p2 && p2[1] === "1" && p2[2] === "5", `block B reads 1/5 (${c3.find((c) => c.id === b2)?.text})`);

const btn = await button();
ok(/Continue 4 \/ 10/.test(btn?.label || ""), `the button continues the selected block (${btn?.label})`);

// Run the selected block and finish one puzzle: only ITS chip may move.
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(4000);
const boardUp = await ev(`!!document.querySelector('[data-testid="board-stage"]')`);
ok(boardUp, "the block put a puzzle on the board");
// Revealing the solution records the attempt; "Next puzzle" is what advances.
await ev(`document.querySelector('[data-testid="solution-button"]')?.click()`);
await sleep(1500);
await ev(`document.querySelector('[data-testid="next-button"]')?.click()`);
await sleep(3500);
const c4 = await chips();
const a4 = seg(c4.find((c) => c.id === b1)?.text);
const b4 = seg(c4.find((c) => c.id === b2)?.text);
console.log("  after one solved puzzle:", JSON.stringify(c4.map((c) => c.text)));
ok(a4 && a4[1] === "5", `the running block advanced to 5 (${c4.find((c) => c.id === b1)?.text})`);
ok(b4 && b4[1] === "1", `the other block did NOT move (${c4.find((c) => c.id === b2)?.text})`);

// ---- 6. PERSISTENCE -------------------------------------------------------
await go();
const c5 = await chips();
ok(seg(c5.find((c) => c.id === b1)?.text)?.[1] === "5", "block A's position survived the reload");
ok(seg(c5.find((c) => c.id === b2)?.text)?.[1] === "1", "block B's position survived the reload");

// ---- 7. RESTART (one block, armed) ---------------------------------------
await ev(`document.querySelector('[data-testid="block-select-${b1}"]')?.click()`);
await sleep(700);
await ev(`document.querySelector('[data-testid="block-restart"]')?.click()`);
await sleep(500);
const armed = await ev(`(() => { const b = document.querySelector('[data-testid="block-restart"]'); return b ? b.innerText.trim() : null; })()`);
ok(/again/i.test(armed || ""), `the restart control arms before wiping progress ("${armed}")`);
await ev(`document.querySelector('[data-testid="block-restart"]')?.click()`);
await sleep(1000);
const c6 = await chips();
ok(seg(c6.find((c) => c.id === b1)?.text)?.[1] === "1", `the restarted block went back to 1 (${c6.find((c) => c.id === b1)?.text})`);
ok(seg(c6.find((c) => c.id === b2)?.text)?.[1] === "1", "the other block was not reset");

// ---- 8. DELETE (armed, one block) ----------------------------------------
await ev(`document.querySelector('[data-testid="block-select-${b2}"]')?.click()`);
await sleep(700);
await ev(`document.querySelector('[data-testid="block-delete"]')?.click()`);
await sleep(400);
const delArmed = await ev(`(() => { const b = document.querySelector('[data-testid="block-delete"]'); return b ? b.innerText.trim() : null; })()`);
ok(/sure/i.test(delArmed || ""), `delete arms first ("${delArmed}")`);
await ev(`document.querySelector('[data-testid="block-delete"]')?.click()`);
await sleep(1200);
const c7 = await chips();
ok(c7.length === 1 && c7[0].id === b1, `only the deleted block went away (${c7.length} left)`);

// ---- 9. THE COUNTER IS GLOBAL: it counts ACROSS a round boundary -----------
// The retired per-block counter reset to "1 / 5" at every round. With 2 rounds of
// 5, finishing round 1's last puzzle must read 6 — not 1.
await ev(`localStorage.setItem('puzzle_trainer_blocks', JSON.stringify({ selected: 'blk_edge', blocks: [
  { id: 'blk_edge', name: 'Boundary', themes: ['fork','pin'], themeIndex: 0, done: 4 }
]}))`);
await go();
const beforeEdge = seg((await chips()).find((c) => c.id === "blk_edge")?.text);
ok(beforeEdge && beforeEdge[1] === "5" && beforeEdge[2] === "10", `one puzzle from the boundary (${(await chips())[0]?.text})`);
await ev(`document.querySelector('[data-testid="block-select-blk_edge"]')?.click()`);
await sleep(800);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(4000);
const liveBefore = await ev(`(document.querySelector('[data-testid="quickrun-counter"]')||{}).innerText?.trim() ?? null`);
ok(liveBefore === "5 / 10", `the live counter agrees before the boundary (${liveBefore})`);
await ev(`document.querySelector('[data-testid="solution-button"]')?.click()`);
await sleep(1500);
await ev(`document.querySelector('[data-testid="next-button"]')?.click()`);
await sleep(4000);
const liveAfter = await ev(`(document.querySelector('[data-testid="quickrun-counter"]')||{}).innerText?.trim() ?? null`);
const chipAfter = seg((await chips()).find((c) => c.id === "blk_edge")?.text);
console.log("  at the boundary:", liveBefore, "->", liveAfter, "| chip:", chipAfter && chipAfter[0] + "/" + chipAfter[1]);
ok(liveAfter === "6 / 10", `it counts ACROSS the round boundary instead of resetting to 1 (${liveAfter})`);
ok(chipAfter && chipAfter[1] === "6", `and the block's own progress agrees (${chipAfter && chipAfter[0] + "/" + chipAfter[1]})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
