/**
 * Independent verification of ITEMS 2, 3 and 5 — the parent agent's own check,
 * written because the subagents could not runtime-test anything (they were told
 * not to build).
 *
 * Harness safety (Item 7): `puzzle_trainer_sync='off'` is installed via
 * Page.addScriptToEvaluateOnNewDocument so it exists BEFORE the app boots, and it
 * is re-installed on every navigation. Without that, seeding pins/settings here
 * would be pushed over the user's real data — the exact bug Item 7 is about.
 * This script also never calls DELETE /api/state.
 *
 * The seed mimics the brief's acceptance case: the user's own 16 pinned themes
 * with quickStartCount 5, i.e. 16 x 5 = 80.
 */
import { WebSocket } from "ws";
import fs from "fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Use the USER'S OWN pinned themes as the 16 blocks, so this is the real case.
const state = JSON.parse(fs.readFileSync("/Users/sam/puzzle-trainer/user-state/state.json", "utf8"));
const pins = JSON.parse(state["puzzle_trainer_pinned_themes"].v);
const realRating = JSON.parse(state["puzzle_trainer_settings"].v).rating;
console.log(`seeding ${pins.length} pins (the user's own) x count 5 = ${pins.length * 5}`);

const list = await (await fetch("http://localhost:9245/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map(); const consoleMsgs = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.consoleAPICalled") {
    consoleMsgs.push((m.params.args || []).map((a) => String(a.value ?? a.description ?? "")).join(" "));
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 664, deviceScaleFactor: 3, mobile: true });

// Sync is off BEFORE the app's JS runs, on EVERY document. Seed only once, so a
// reload genuinely tests persistence instead of re-seeding.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    localStorage.setItem('puzzle_trainer_sync','off');
    if (!localStorage.getItem('__hv_seeded')) {
      localStorage.setItem('__hv_seeded','1');
      localStorage.setItem('puzzle_trainer_pinned_themes', ${JSON.stringify(JSON.stringify(pins))});
      localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: ${realRating}, quickStartCount: 5 }));
      // Themes now live in per-block storage. Clearing the blocks key (and the
      // retired run key) makes the pins above seed Block 1 through the migration,
      // starting at round 1 so the counter assertions below are exact.
      localStorage.removeItem('puzzle_trainer_blocks');
      localStorage.removeItem('puzzle_trainer_quickrun');
    }
  `,
});

const btn = () => ev(`(document.querySelector('[data-testid="quickstart-button"]')||{}).innerText?.trim() ?? null`);
const counter = () => ev(`(document.querySelector('[data-testid="quickrun-counter"]')||{}).innerText?.trim() ?? null`);
const plan = () => ev(`(document.querySelector('[data-testid="quickrun-plan"]')||{}).innerText?.replace(/\\s+/g,' ').trim() ?? null`);
const stored = () => ev(`(() => { try {
  const s = JSON.parse(localStorage.getItem('puzzle_trainer_blocks'));
  const b = s.blocks.find((x) => x.id === s.selected) || s.blocks[0];
  return JSON.stringify(b);
} catch { return null; } })()`);

await send("Page.navigate", { url: "http://localhost:3000/?hv=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="tab-training"]')?.click()`);
await sleep(2000);

// ---- ITEM 5: nothing running -> the button offers to START the selected block
const label0 = await btn();
ok(/Start/i.test(label0 ?? ""), `ITEM 5: with nothing running the button offers a start (got ${JSON.stringify(label0)})`);

// ---- ITEM 2: the plan line --------------------------------------------------
const plan0 = await plan();
ok(/16 themes/.test(plan0 ?? "") && /80 puzzles/.test(plan0 ?? ""),
   `ITEM 2: pre-start plan reads 16 themes x 5 = 80 puzzles (got ${JSON.stringify(plan0)})`);

// ---- ITEM 2: start, and the counter must be GLOBAL --------------------------
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);
const c1 = await counter();
ok(c1 === "1 / 80", `ITEM 2: counter reads "1 / 80" at the start (got ${JSON.stringify(c1)})`);

// ---- ITEM 2: the counter advances past the END OF A BLOCK ------------------
// count is 5, so position 6 is the first puzzle of block 2. This is the case the
// old per-block counter got wrong: it showed "1 / 6" again at every block.
const seen = [c1];
for (let i = 0; i < 6; i++) {
  await ev(`(document.querySelector('[data-testid="skip-button"]') || document.querySelector('[data-testid="next-button"]'))?.click()`);
  await sleep(6500);
  seen.push(await counter());
}
console.log("  counter sequence:", seen.join(" -> "));
ok(seen.includes("6 / 80") || seen.includes("7 / 80"),
   `ITEM 2: the counter keeps counting ACROSS a block boundary instead of resetting to "1 / 6" (saw ${seen.join(", ")})`);
ok(seen.filter(Boolean).every((s) => /^\d+ \/ 80$/.test(s)),
   `ITEM 2: every reading is "N / 80" (per-block counts are gone)`);

// ---- ITEM 3: advancing PERSISTS --------------------------------------------
const raw1 = await stored();
ok(!!raw1, `ITEM 3: advancing wrote the block to localStorage (${String(raw1).slice(0, 90)})`);
let parsed = null; try { parsed = JSON.parse(raw1); } catch { /* ignore */ }
// `count` (puzzles per theme) is no longer part of the block: it is the single
// global setting, read live. The block keeps only its themes and its position.
ok(parsed && typeof parsed.themeIndex === "number" && typeof parsed.done === "number",
   `ITEM 3: the stored block carries themeIndex/done (${JSON.stringify(parsed && { t: parsed.themeIndex, d: parsed.done, n: parsed.themes?.length })})`);
ok(parsed && Array.isArray(parsed.themes) && parsed.themes.length === 16,
   `ITEM 3: stored block keeps all 16 ordered theme ids (got ${parsed?.themes?.length})`);

// ---- ITEM 3 + 5: reload (stand-in for closing the tab) -> "Continue" ---------
await send("Page.navigate", { url: "http://localhost:3000/?hv=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="tab-training"]')?.click()`);
await sleep(2000);
const label1 = await btn();
const posNow = parsed ? parsed.themeIndex * 5 + parsed.done + 1 : NaN;
ok(new RegExp(`Continue\\s*${posNow}\\s*\\/\\s*80`, "i").test(label1 ?? ""),
   `ITEM 5: after a reload the button offers to resume (want "Continue ${posNow} / 80", got ${JSON.stringify(label1)})`);
ok((await counter()) === null, "ITEM 3: no live block after reload until you resume (counter absent)");

// ---- ITEM 3: the brief's exact case — resume at 23/80 -----------------------
// Write the block the way advancing to 23 would have left it: count 5, so
// themeIndex 4 + done 2 => 4*5+2+1 = 23. Then reload and resume.
await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('puzzle_trainer_blocks'));
  const i = s.blocks.findIndex((x) => x.id === s.selected);
  s.blocks[i < 0 ? 0 : i].themeIndex = 4;
  s.blocks[i < 0 ? 0 : i].done = 2;
  localStorage.setItem('puzzle_trainer_blocks', JSON.stringify(s));
  localStorage.removeItem('__resume_probe');
})()`);
await send("Page.navigate", { url: "http://localhost:3000/?hv=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="tab-training"]')?.click()`);
await sleep(2000);
const label2 = await btn();
ok(/Continue\s*23\s*\/\s*80/i.test(label2 ?? ""),
   `ITEM 5: the brief's case reads "Continue 23 / 80" (got ${JSON.stringify(label2)})`);

await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);
const c2 = await counter();
ok(c2 === "23 / 80", `ITEM 3: resuming puts the counter back at "23 / 80" (got ${JSON.stringify(c2)})`);
const onBoard = await ev(`!!document.querySelector('[data-board-context="training"] cg-board, [data-board-context="training"] .cg-wrap')`);
ok(onBoard, "ITEM 3: resuming actually serves a puzzle (the block continues, not just the label)");

// ---- console hygiene --------------------------------------------------------
const dupeKey = consoleMsgs.filter((m) => /unique .?key|same key/i.test(m));
ok(dupeKey.length === 0, `no duplicate-key React warnings (${dupeKey.length})${dupeKey.length ? ": " + dupeKey[0].slice(0, 160) : ""}`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
