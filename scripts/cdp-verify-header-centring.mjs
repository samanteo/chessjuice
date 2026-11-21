/**
 * Header progress pill must sit in the MIDDLE of the space between the end of
 * "Puzzle Trainer" and the settings cog — at phone width, with a due badge in
 * the mix (the badge used to steal the space and pull the pill left).
 *
 * Checks:
 *  1. at 430px the pill's centre == the midpoint of title.right .. gear.x
 *  2. the gaps either side of the pill are equal (±1px)
 *  3. the desktop-only Due badge is NOT rendered in the header on a phone
 *  4. the due count instead appears on the Review tab in the mobile nav
 *  5. the pill keeps the same box when a due puzzle exists (layout is stable)
 */
import { WebSocket } from "ws";

const PORT = 9245;
const BASE = "http://localhost:3000";
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const sock = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0;
const pending = new Map();
sock.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => sock.on("open", r));
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
};

const geo = () => ev(`(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) }; };
  const title = document.querySelector('[data-testid="home-logo"]');
  const pill = document.querySelector('[data-testid="header-progress"]');
  const gear = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '⚙️').pop();
  // Only the HEADER's Due badge matters here — the main panel also renders
  // "⏰ N puzzles due for review" and "⏰ Review Due (N)" buttons, which are not
  // part of the header row and must not be mistaken for it.
  const headerBadge = [...document.querySelectorAll('header button')].find(b => /Due/.test(b.textContent) && b.getBoundingClientRect().width > 0);
  const navBadge = document.querySelector('[data-testid="review-due-count"]');
  return {
    title: rect(title), pill: rect(pill), gear: rect(gear),
    pillText: pill ? pill.textContent.trim() : null,
    headerBadgeVisible: !!headerBadge,
    navBadgeVisible: !!navBadge && navBadge.getBoundingClientRect().width > 0,
    navBadgeText: navBadge ? navBadge.textContent.trim() : null,
    vw: window.innerWidth
  };
})()`);

// ---------- Phase 1: no due puzzles ----------
await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: BASE + "/" });
await sleep(2500);
await ev(`localStorage.removeItem('puzzle_trainer_progress_v2')`);
await send("Page.reload", { ignoreCache: true });
await sleep(3500);

let g = await geo();
check("pill is rendered at phone width", !!g.pill, JSON.stringify(g));
check("title and gear are measurable", !!g.title && !!g.gear);
if (g.title && g.pill && g.gear) {
  const mid = Math.round((g.title.right + g.gear.x) / 2);
  const pillMid = Math.round(g.pill.x + g.pill.w / 2);
  const gapL = g.pill.x - g.title.right;
  const gapR = g.gear.x - g.pill.right;
  check("pill centre == midpoint of title.right..gear.x", Math.abs(pillMid - mid) <= 1, `mid=${mid} pillMid=${pillMid} off=${pillMid - mid}`);
  check("gaps either side of the pill are equal", Math.abs(gapL - gapR) <= 1, `gapL=${gapL} gapR=${gapR}`);
  check("pill does not overlap the title", gapL > 0, `gapL=${gapL}`);
  check("pill does not overlap the gear", gapR > 0, `gapR=${gapR}`);
}
check("no Due badge in the header on a phone", g.headerBadgeVisible === false);
check("no Review-tab count when nothing is due", g.navBadgeVisible === false);

// ---------- Phase 2: one due puzzle ----------
const row = await (await fetch(`${BASE}/api/puzzles?limit=1`)).json();
const dueId = row[0].id;
await ev(`(() => {
  const now = Date.now();
  localStorage.setItem('puzzle_trainer_progress_v2', JSON.stringify({
    '${dueId}': { rg: 0, due: new Date(now - 60000).toISOString(), wr: 1, at: 1, co: 0 }
  }));
})()`);
await send("Page.reload", { ignoreCache: true });
await sleep(4000);

const g2 = await geo();
check("Due badge stays out of the header when a puzzle is due", g2.headerBadgeVisible === false);
check("Review tab shows the due count on a phone", g2.navBadgeVisible === true, `text=${g2.navBadgeText}`);
check("Review tab count reads 1", g2.navBadgeText === "1", `text=${g2.navBadgeText}`);
if (g2.title && g2.pill && g2.gear) {
  const mid = Math.round((g2.title.right + g2.gear.x) / 2);
  const pillMid = Math.round(g2.pill.x + g2.pill.w / 2);
  check("pill stays centred with a due puzzle present", Math.abs(pillMid - mid) <= 1, `mid=${mid} pillMid=${pillMid}`);
  check("pill box is unchanged by the due count", g2.pill.x === g.pill.x && g2.pill.w === g.pill.w, `before=${g.pill.x}/${g.pill.w} after=${g2.pill.x}/${g2.pill.w}`);
}

// ---------- Phase 3: desktop keeps the badge ----------
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
const g3 = await geo();
check("desktop keeps the Due badge in the header", g3.headerBadgeVisible === true);

// ---------- Phase 4: OFF state occupies the same box ----------
await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 2, mobile: true });
// Force the pill ON first: an earlier run may have left it OFF, and the whole
// point of this phase is watching the ON -> OFF transition.
await ev(`(() => {
  const raw = localStorage.getItem('puzzle_trainer_settings');
  const s = raw ? JSON.parse(raw) : {};
  s.showGlobalProgress = true;
  localStorage.setItem('puzzle_trainer_settings', JSON.stringify(s));
})()`);
await send("Page.reload", { ignoreCache: true });
await sleep(3000);
const before = await geo();
check("pill starts ON for the OFF-state check", before.pillText !== "OFF", `text=${before.pillText}`);
// A real mouse event: el.click() was swallowed when the reload had not settled.
const pillBox = await ev(`(() => { const r = document.querySelector('[data-testid="header-progress"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pillBox.x, y: pillBox.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pillBox.x, y: pillBox.y, button: "left", clickCount: 1 });
await sleep(1200);
const after = await geo();
check("OFF label renders", after.pillText === "OFF", `text=${after.pillText}`);
check("pill box does not move between ON and OFF", before.pill.x === after.pill.x && before.pill.w === after.pill.w, `ON=${before.pill.x}/${before.pill.w} OFF=${after.pill.x}/${after.pill.w}`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
sock.close();
process.exit(fail === 0 ? 0 : 1);
