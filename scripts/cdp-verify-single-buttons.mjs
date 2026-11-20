/**
 * The board must render EXACTLY ONE Hard and ONE Next-puzzle button.
 *
 * It used to render the new primary column AND an older "Solved — or mark it Hard
 * if it was a lucky guess." bar, each with its own Hard + Next — four buttons
 * where there should be two.
 *
 * Also asserts the layout the user asked for: Next on TOP, Hard directly below,
 * and Next the larger of the two.
 */
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

// Every button that is a Hard or a Next, however it is labelled/identified.
const counts = () => ev(`(() => {
  const byText = (re) => [...document.querySelectorAll('button')]
    .filter(b => re.test((b.innerText||'').trim()));
  const hards = byText(/Hard/i);
  const nexts = byText(/Next puzzle/i);
  const hardIds = [...document.querySelectorAll('[data-testid*="hard"]')].map(e=>e.getAttribute('data-testid'));
  const nextIds = [...document.querySelectorAll('[data-testid*="next"]')].map(e=>e.getAttribute('data-testid'));
  const r = (e) => { const b = e.getBoundingClientRect(); return { y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    hardCount: hards.length, nextCount: nexts.length,
    hardIds, nextIds,
    hard: hards[0] ? r(hards[0]) : null,
    next: nexts[0] ? r(nexts[0]) : null,
    nextInNav: nexts[0] ? !!nexts[0].closest('[data-testid="move-nav"]') : null,
  };
})()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// Mid-puzzle: Skip (not Next) + one Hard.
await ev(`document.querySelector('[data-testid="quickstart-button"]').click()`);
await sleep(9000);
const mid = await counts();
console.log("mid-puzzle:", JSON.stringify(mid));
ok(mid.hardCount === 1, `exactly ONE Hard button mid-puzzle (${mid.hardCount})`);
ok(mid.nextCount === 0, `no "Next puzzle" mid-puzzle — it is Skip (${mid.nextCount})`);

// Resolve the puzzle so Next appears.
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Solution$/i.test(x.innerText.trim())); b&&b.click(); })()`);
await sleep(4500);
const solved = await counts();
console.log("solved/failed:", JSON.stringify(solved));
ok(solved.hardCount === 1, `exactly ONE Hard button when resolved (${solved.hardCount}) — was 2`);
ok(solved.nextCount === 1, `exactly ONE Next puzzle button (${solved.nextCount}) — was 2`);
ok(
  !(solved.hardIds ?? []).some((t) => /correct/.test(t ?? "")) &&
  !(solved.nextIds ?? []).some((t) => /correct/.test(t ?? "")),
  `no leftover duplicate ids (${JSON.stringify(solved.nextIds)})`
);
ok(solved.next && solved.hard && solved.next.y < solved.hard.y,
   `Next is ABOVE Hard (next y=${solved.next?.y} < hard y=${solved.hard?.y})`);
// Next now lives in the move-nav row directly UNDER THE BOARD (moved there so a
// failed puzzle can be answered fast: Solution + Next without scrolling). It is
// therefore a compact button, NOT the full-width one stacked above Hard — so the
// old "at least as wide as Hard" assertion described the pre-move layout and is
// now asserted against the new intent instead.
ok(solved.nextInNav === true, `Next sits in the move-nav row (${solved.nextInNav})`);
ok(solved.next && solved.next.w >= 80, `Next is a comfortable tap target (${solved.next?.w}px wide)`);
ok(solved.next && solved.next.h >= 30, `Next is a large tap target (${solved.next?.h}px tall)`);

// The "mark it Hard if it was a lucky guess" hint only rides the CORRECT-solve
// feedback ("Correct! 🎉 — or mark it Hard…"). We got here by revealing the
// solution, so asserting it on screen would be checking the wrong path — an
// earlier version of this test did exactly that and reported a false FAIL.
// Check the component source itself (fetch('/') would only return the HTML shell).
const boardSrc = readFileSync(new URL("../src/components/PuzzleBoard.tsx", import.meta.url), "utf8");
ok(/setFeedback\("Correct! 🎉 — or mark it Hard/.test(boardSrc),
   "correct-solve feedback still carries the 'mark it Hard' hint (source)");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
