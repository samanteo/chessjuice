/**
 * Regression: the DOTS switch in the board head.
 *
 * "Guiding dots" = the legal-move markers chessground draws on the squares a
 * selected piece can move to. The switch sits directly under TAGS, is styled the
 * same (green + name when on, red "OFF" when off), and must:
 *   1. exist on EVERY board (the head is shared by Training / Review / All themes)
 *   2. start ON — that is how the board behaved before the switch existed
 *   3. actually remove the markers from the DOM when switched off, live
 *   4. remember the choice across a reload
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

const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};
const geo = () => ev(`(() => { const b = document.querySelector('cg-board'); const r = b.getBoundingClientRect(); const w = b.closest('.cg-wrap'); return { x: r.x, y: r.y, w: r.width, orient: (w?.className||'').includes('black') ? 'black' : 'white' }; })()`);
const xy = (g, sq) => { const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]), s = g.w / 8;
  return { x: g.x + (g.orient === 'black' ? 7 - f : f) * s + s / 2, y: g.y + (g.orient === 'black' ? rk - 1 : 8 - rk) * s + s / 2 }; };
// The rendered markers: chessground stamps <square class="move-dest"> for plain
// moves and adds `oc` when the target holds a piece (capture). The wrapper also
// mirrors the resolved flag on data-dests.
const markers = () => ev(`document.querySelectorAll('cg-board square.move-dest').length`);
const flag = () => ev(`(() => { const el = document.querySelector('.cg-wrap') || document.querySelector('[data-dests]'); return el ? el.getAttribute('data-dests') : null; })()`);
const dotsState = () => ev(`(() => { const b = document.querySelector('[data-testid="dots-toggle"]'); return b ? { present: true, on: b.getAttribute('data-on'), label: (b.innerText||'').trim() } : { present: false }; })()`);

await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}" });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(3500);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off'); localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]));`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(4500);

// Start a puzzle so a board is up.
ok(await ev(`(() => { const b = document.querySelector('[data-testid="quickstart-button"]'); if (b) { b.click(); return true; } return false; })()`), "started a puzzle");
await sleep(4000);

// Which piece can move? Read the served puzzle's first solver move.
const pid = await ev(`(() => { const t = document.querySelector('.board-panel__title'); const m = (t?.innerText || document.body.innerText).match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
const p = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid}`)).json();
const moves = (p.moves || "").split(" ").filter(Boolean);
const from = moves[1].slice(0, 2);
console.log(`puzzle ${pid}, first solver move ${moves[1]}`);

const d0 = await dotsState();
ok(d0.present, "a DOTS switch is present in the board head");
ok(d0.on === "true", "it starts ON");
ok(d0.label === "DOTS", `the ON label reads its name like TAGS does ("${d0.label}")`);

// The switch must sit SIDE BY SIDE with the tags switch, same style. It used to
// stack below it, which cost ~24px of head height and pushed the controls under
// the board below the fold on a short phone — so "below" is now a regression.
const order = await ev(`(() => {
  const t = document.querySelector('[data-testid="tags-toggle"]');
  const d = document.querySelector('[data-testid="dots-toggle"]');
  if (!t || !d) return null;
  const tr = t.getBoundingClientRect(), dr = d.getBoundingClientRect();
  return { sameRow: Math.abs(dr.top - tr.top) < 2, rightOf: dr.left > tr.left, sameClass: d.className === t.className };
})()`);
ok(order && order.sameRow, "DOTS sits SIDE BY SIDE with TAGS on one row");
ok(order && order.rightOf, "DOTS is to the right of TAGS");
ok(order && order.sameClass, "it uses the very same switch styling as TAGS");

// Select a piece -> chessground draws the guiding dots.
const g = await geo();
const a = xy(g, from);
await click(a.x, a.y);
await sleep(700);
const withDots = await markers();
console.log(`  markers with dots ON: ${withDots}`);
ok(withDots > 0, "selecting a piece draws its legal-move dots");

// Switch the dots OFF while the piece is still selected: they must vanish live.
await ev(`document.querySelector('[data-testid="dots-toggle"]')?.click()`);
await sleep(700);
const offState = await dotsState();
const withoutDots = await markers();
console.log(`  markers with dots OFF: ${withoutDots} (switch says ${offState.label})`);
ok(offState.on === "false", "the switch reports OFF");
ok(withoutDots === 0, "the guiding dots are gone from the board");
ok((await flag()) === "false", "the board mirrors the resolved flag (data-dests=false)");

// The choice must survive a reload. A reload lands on the Training home (no
// board, so no switch), so start a puzzle again before reading it.
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(5000);
ok(!(await ev(`!!document.querySelector('[data-testid="dots-toggle"]')`)), "reload lands on the board-less home");
await ev(`(() => { const b = document.querySelector('[data-testid="quickstart-button"]'); if (b) b.click(); })()`);
await sleep(4000);
const afterReload = await dotsState();
ok(afterReload.present && afterReload.on === "false", `OFF survives a reload (reads "${afterReload.label}")`);

// ...and switching back ON restores them.
await ev(`document.querySelector('[data-testid="dots-toggle"]')?.click()`);
await sleep(700);
const g2 = await geo();
const pid2 = await ev(`(() => { const t = document.querySelector('.board-panel__title'); const m = (t?.innerText || document.body.innerText).match(/Puzzle #([A-Za-z0-9]{5})/); return m ? m[1] : null; })()`);
const p2 = await (await fetch(`http://localhost:3000/api/puzzle?id=${pid2}`)).json();
const mv2 = (p2.moves || "").split(" ").filter(Boolean);
const a2 = xy(g2, mv2[1].slice(0, 2));
await click(a2.x, a2.y);
await sleep(800);
const back = await markers();
const backFlag = await flag();
console.log(`  markers after switching back ON: ${back} (data-dests=${backFlag})`);
ok(back > 0, "switching it back ON brings the dots back");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
