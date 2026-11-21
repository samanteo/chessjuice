/**
 * HEAD LAYOUT — the board head above the board must be short enough that the
 * controls under the board are reachable without scrolling on a phone.
 *
 * What this covers, and why each one is a real regression risk:
 *   1. TAGS and DOTS sit SIDE BY SIDE on the theme-label row. They used to be a
 *      stacked column in the ratings row, which cost ~24px of height and pushed
 *      the controls under the board below the fold at 390x664.
 *   2. The pair shares the label's row — it must not cost a row of its own.
 *   3. No "White/Black to move" text: the colour dot carries the colour.
 *   4. The dot is VISIBLE on the head's background (black dot needs a light rim).
 *   5. The two ratings are ONE pill ("1536 · you 1500"), not two.
 *   6. The head does not overflow horizontally, and the whole panel fits one
 *      phone screen at 390x844.
 *
 * Run serially — one browser, so two tests at once corrupt each other.
 */
import { WebSocket } from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9245/json/list")).json();
const target = list.find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

await send("Runtime.enable");
await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// Isolated harness: sync OFF before the app's first script runs, so this test
// can never push its settings/pins into the user's real store.
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork','pin']))`);
await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ showTags: true, showDots: true, quickStartCount: 5 }))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(8000);

const snap = () => ev(`(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
  const head = document.querySelector('.board-panel__head');
  const dot = document.querySelector('[data-testid="solver-color-dot"]');
  const ratings = document.querySelector('[data-testid="board-ratings"]');
  const chips = document.querySelectorAll('[data-testid="puzzle-themes"] .theme-chip');
  const last = document.querySelector('[data-testid="skip-button"]') || document.querySelector('[data-testid="next-button"]');
  const headStyle = head ? getComputedStyle(head) : null;
  const dotStyle = dot ? getComputedStyle(dot) : null;
  return {
    vw: innerWidth, vh: innerHeight,
    head: r('.board-panel__head'),
    headOverflow: head ? head.scrollWidth - head.clientWidth : null,
    headBg: headStyle ? headStyle.backgroundColor : null,
    label: r('[data-testid="active-theme"]'),
    tags: r('[data-testid="tags-toggle"]'),
    dots: r('[data-testid="dots-toggle"]'),
    title: r('.board-panel__title'),
    ratings: r('[data-testid="board-ratings"]'),
    ratingPills: ratings ? ratings.querySelectorAll('.pill').length : null,
    ratingText: ratings ? ratings.innerText.replace(/\\s+/g, ' ').trim() : null,
    userRating: document.querySelector('[data-testid="user-rating"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    chipCount: chips.length,
    chipRight: chips.length ? Math.round(Math.max(...[...chips].map((c) => c.getBoundingClientRect().right))) : null,
    board: r('[data-testid="board-stage"]'),
    lastCtrl: last ? { text: last.innerText.trim(), ...r('[data-testid="skip-button"]') } : null,
    toMoveText: /White to move|Black to move/i.test(document.body.innerText),
    dot: dot ? { color: dot.dataset.color, bg: dotStyle.backgroundColor, ring: dotStyle.boxShadow } : null,
    docH: document.documentElement.scrollHeight,
  };
})()`);

const s = await snap();
console.log("head:", JSON.stringify(s));

// ---- 1. TAGS and DOTS: side by side, one row -------------------------------
ok(!!s.tags && !!s.dots, "both switches are present");
if (s.tags && s.dots) {
  ok(Math.abs(s.tags.y - s.dots.y) <= 2, `TAGS and DOTS share one row (y ${s.tags.y} vs ${s.dots.y})`);
  ok(s.dots.x > s.tags.x, `DOTS sits to the RIGHT of TAGS (x ${s.dots.x} > ${s.tags.x})`);
  ok(s.tags.right <= s.dots.x + 2, "they do not overlap");
}

// ---- 2. The pair rides the theme-label row (no extra row) ------------------
if (s.label && s.tags) {
  ok(Math.abs(s.label.y - s.tags.y) <= 6, `the switches sit on the theme-label row (y ${s.label.y} vs ${s.tags.y})`);
  ok(s.tags.x > s.label.x, "the switches sit to the right of the theme label");
}

// ---- 3. No "to move" text -------------------------------------------------
ok(s.toMoveText === false, "no 'White/Black to move' text — the dot carries the colour");

// ---- 4. The colour dot is visible -----------------------------------------
ok(!!s.dot, "the colour dot exists");
if (s.dot) {
  ok(s.dot.color === "white" || s.dot.color === "black", `the dot states the colour (${s.dot.color})`);
  const ring = (s.dot.ring || "").match(/(\d+(?:\.\d+)?)px/g);
  const ringPx = ring ? Math.max(...ring.map((v) => parseFloat(v))) : 0;
  ok(ringPx >= 1, `the dot has a visible rim (${ringPx}px)`);
  // A BLACK dot on a dark head with no rim is invisible: demand a light rim.
  if (s.dot.color === "black") {
    ok(/255, 255, 255|250, 250, 250|245, 245, 245/.test(s.dot.ring || ""), "the black dot carries a LIGHT rim so it shows on the dark head");
  }
}

// ---- 5. One merged rating pill --------------------------------------------
ok(s.ratingPills === 1, `the two ratings are ONE pill (found ${s.ratingPills})`);
ok(/\d/.test(s.ratingText || "") && /you/i.test(s.ratingText || ""), `the pill carries both numbers (${s.ratingText})`);
ok(!!s.userRating && /\d/.test(s.userRating), `your rating stays individually addressable (${s.userRating})`);

// ---- 6. Nothing overflows; the panel fits one phone screen ----------------
ok(s.headOverflow !== null && s.headOverflow <= 0, `the head does not overflow horizontally (${s.headOverflow})`);
if (s.chipRight !== null) ok(s.chipRight <= s.head.right, `the theme chips stay inside the head (${s.chipRight} <= ${s.head.right})`);
ok(s.head.h <= 130, `the head stays short (${s.head.h}px at ${s.vw}px wide)`);
ok(s.lastCtrl && s.lastCtrl.bottom <= s.vh, `the controls under the board fit the screen (${s.lastCtrl?.bottom} <= ${s.vh})`);

// ---- 7. Switching DOTS off must not move the head --------------------------
const beforeH = s.head.h;
await ev(`document.querySelector('[data-testid="dots-toggle"]').click()`);
await sleep(1200);
const afterToggle = await snap();
ok(afterToggle.head.h === beforeH, `flipping DOTS does not change the head height (${beforeH} -> ${afterToggle.head.h})`);
await ev(`document.querySelector('[data-testid="dots-toggle"]').click()`);
await sleep(800);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
