/**
 * TAGS switch acceptance test.
 *
 * The head carries a small on/off switch that shows or hides the puzzle's theme
 * chips. Requirements from the user:
 *   1. It is OFF by default — tags are a hint, so they must not appear unless asked.
 *   2. OFF reads "OFF" on a red capsule; ON reads "TAGS" on a green capsule.
 *   3. Tapping it shows ALL of the puzzle's themes, and tapping again hides them.
 *   4. The choice PERSISTS across a reload (it lives in user settings).
 *   5. The switch never pushes the board off-screen or shrinks it: the board stays
 *      full-bleed at 390px, and the head stays on one row when tags are hidden.
 *
 * Isolated boot: `puzzle_trainer_sync=off` is set BEFORE the app's first script,
 * so nothing here can reach the user's real /api/state store.
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

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.log("  FAIL", msg); } };

const snap = () => ev(`(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const t = document.querySelector('[data-testid="tags-toggle"]');
  const themes = document.querySelector('[data-testid="puzzle-themes"]');
  const chips = [...document.querySelectorAll('.theme-chip')].filter(c => c.offsetParent !== null);
  const board = document.querySelector('cg-board');
  return {
    vw: innerWidth,
    togglePresent: !!t,
    on: t?.getAttribute('data-on') ?? null,
    pressed: t?.getAttribute('aria-pressed') ?? null,
    label: (t?.innerText ?? '').trim(),
    toggleRect: R(t),
    themesPresent: !!themes,
    chipCount: chips.length,
    chipRows: [...new Set(chips.map(c => Math.round(c.getBoundingClientRect().top)))].length,
    chipRight: chips.length ? Math.max(...chips.map(c => Math.round(c.getBoundingClientRect().right))) : null,
    headH: R(document.querySelector('.board-panel__head'))?.h ?? null,
    board: R(board),
    boardW: board ? Math.round(board.getBoundingClientRect().width) : null,
    docScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`);

await send("Runtime.enable");
await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });

await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork','pin']))`);
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1500, quickStartCount: 6 }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(9000);

// ---- 1. Default OFF ---------------------------------------------------------
const a = await snap();
console.log("default:", JSON.stringify(a));
ok(a.togglePresent, "the TAGS switch is in the head");
ok(a.on === "false", `it starts OFF (data-on=${a.on})`);
ok(a.label === "OFF", `the OFF state reads "OFF" (${a.label})`);
ok(a.pressed === "false", "aria-pressed is false");
ok(!a.themesPresent && a.chipCount === 0, `no theme chips while OFF (${a.chipCount})`);
ok(a.headH !== null && a.headH <= 96, `head stays compact while OFF (${a.headH}px)`);
ok(a.boardW !== null && Math.abs(a.boardW - a.vw) <= 2, `board is full-bleed while OFF (${a.boardW}px of ${a.vw})`);
ok(!a.docScrollX, "nothing overflows sideways");

// ---- 2. Tap ON --------------------------------------------------------------
await ev(`document.querySelector('[data-testid="tags-toggle"]').click()`);
await sleep(1200);
const b = await snap();
console.log("after tap:", JSON.stringify(b));
ok(b.on === "true", `one tap turns it ON (data-on=${b.on})`);
ok(b.label === "TAGS", `the ON state reads "TAGS" (${b.label})`);
ok(b.pressed === "true", "aria-pressed is true");
ok(b.themesPresent && b.chipCount >= 1, `theme chips appear (${b.chipCount})`);
ok(b.chipRight === null || b.chipRight <= b.vw + 1, `chips stay inside the viewport (right ${b.chipRight} <= ${b.vw})`);
ok(b.boardW !== null && Math.abs(b.boardW - b.vw) <= 2, `board still full-bleed with tags shown (${b.boardW}px)`);
ok(!b.docScrollX, "no sideways overflow with tags shown");

// ---- 3. Tap OFF again -------------------------------------------------------
await ev(`document.querySelector('[data-testid="tags-toggle"]').click()`);
await sleep(1200);
const c = await snap();
console.log("after second tap:", JSON.stringify(c));
ok(c.on === "false", "a second tap turns it OFF again");
ok(!c.themesPresent && c.chipCount === 0, "chips are removed when switched OFF");

// ---- 4. Persistence across reload ------------------------------------------
await ev(`document.querySelector('[data-testid="tags-toggle"]').click()`);
await sleep(1200);
const onBefore = await snap();
ok(onBefore.on === "true", "switched ON before the reload");
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
await sleep(9000);
const d = await snap();
console.log("after reload:", JSON.stringify(d));
ok(d.on === "true", `the ON choice survives a reload (data-on=${d.on})`);
ok(d.themesPresent && d.chipCount >= 1, `tags are still shown after reload (${d.chipCount})`);

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
