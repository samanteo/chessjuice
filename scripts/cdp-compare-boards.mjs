/**
 * Side-by-side comparison of the TRAINING board and the REVIEW board.
 *
 * Drives the real flow at each viewport (train -> fail -> Review -> Review Due)
 * and captures a screenshot of each board plus every box the layout depends on,
 * so the two can be diffed numerically as well as visually.
 */
import { WebSocket } from "ws";
import { writeFileSync } from "fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`/tmp/${name}.png`, Buffer.from(r.result.data, "base64")); };

const measure = () => ev(`(() => {
  const R = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const timer = document.querySelector('[data-testid="puzzle-timer"]');
  const onBoard = timer ? (() => { const a = timer.getBoundingClientRect(); const br = document.querySelector('cg-board').getBoundingClientRect();
      return a.top >= br.top && a.bottom <= br.bottom && a.left >= br.left && a.right <= br.right; })() : null;
  const nav = document.querySelector('[data-testid="move-nav"]');
  return {
    vw: innerWidth, vh: innerHeight,
    navScroll: nav ? { sw: nav.scrollWidth, cw: nav.clientWidth } : null,
    timerInNav: timer ? !!timer.closest('[data-testid="move-nav"]') : null,
    ctx: document.querySelector('[data-board-context]')?.getAttribute('data-board-context') ?? null,
    board: R('cg-board'), panel: R('.board-panel'), head: R('.board-panel__head'),
    movenav: R('[data-testid="move-nav"]'), foot: R('.board-panel__foot'),
    strip: R('[data-testid="session-strip"]'), stripLabel: document.querySelector('[data-testid="session-label"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
    squares: document.querySelectorAll('[data-testid^="session-square-"]').length,
    theme: document.querySelector('[data-testid="active-theme"]')?.innerText?.trim() ?? null,
    timerText: timer?.innerText?.trim() ?? null, timerOnBoard: onBoard, timerCovering: timer ? (() => {
      const tr = timer.getBoundingClientRect();
      return [...document.querySelectorAll('piece')].some(pc => { const b = pc.getBoundingClientRect();
        return b.left < tr.right && tr.left < b.right && b.top < tr.bottom && tr.top < b.bottom; });
    })() : null,
    buttons: [...document.querySelectorAll('.board-panel button')].map(b => (b.innerText||b.getAttribute('aria-label')||'').trim()).filter(Boolean),
  };
})()`);

const show = (tag, d) => {
  console.log(`\n--- ${tag} ctx=${d.ctx} vw=${d.vw}`);
  for (const k of ["board", "head", "movenav", "foot", "strip"]) {
    const v = d[k];
    console.log(`    ${k.padEnd(8)} ${v ? `w=${String(v.w).padStart(4)} h=${String(v.h).padStart(3)} top=${String(v.t).padStart(4)} bottom=${String(v.b).padStart(4)}` : "none"}`);
  }
  console.log(`    strip label: ${d.stripLabel}   squares=${d.squares}`);
  console.log(`    theme="${d.theme}"  timer="${d.timerText}"  on-board=${d.timerOnBoard}  covering-piece=${d.timerCovering}  in-nav-row=${d.timerInNav}`);
  const fit = d.navScroll ? d.navScroll.sw <= d.navScroll.cw + 1 : null;
  console.log(`    nav row overflow: ${fit === null ? "n/a" : fit ? "NO overflow" : "OVERFLOW"} (scrollW ${d.navScroll?.sw} vs clientW ${d.navScroll?.cw})`);
  console.log(`    buttons: ${d.buttons.join(" | ")}`);
};

async function boot(w, h, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(12000);
  await ev(`localStorage.clear()`);
  await ev(`localStorage.setItem('puzzle_trainer_sync','off')`);
  await ev(`localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(["fork"]))`);
  await ev(`localStorage.setItem('puzzle_trainer_settings', JSON.stringify({ rating: 1500, quickStartCount: 6 }))`);
  // Per-puzzle clock ON, so the countdown is on screen for both boards.
  await ev(`localStorage.setItem('puzzle_trainer_theme_prefs', JSON.stringify({ boardTheme:"green", pieceSet:"cburnett", uiTheme:"dark", coordinates:true, animation:true, highlightLastMove:true, highlightCheck:true, pieceAnimation:true, autoCastle:true, autoPromoteToQueen:true, blockTouchScroll:true, puzzleTimerSeconds:60 }))`);
  await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
  await sleep(15000);
}

for (const [w, h, mobile, tag] of [[390, 844, true, "390"], [1408, 881, false, "1408"]]) {
  console.log(`\n================= ${tag} =================`);
  await boot(w, h, mobile);

  // --- Training ---
  await ev(`document.querySelector('[data-testid="quickstart-button"]')?.click()`);
  await sleep(9000);
  const tr = await measure();
  show("TRAINING", tr);
  await shot(`cmp-${tag}-training`);

  // Fail it → it enters the mistakes deck.
  await ev(`document.querySelector('[data-testid="solution-button"]')?.click()`);
  await sleep(3500);

  // --- Review ---
  await ev(`(() => { const b=[...document.querySelectorAll('header nav button')].find(x=>/Review/i.test(x.innerText)); b&&b.click(); })()`);
  await sleep(2500);
  const started = await ev(`(() => {
    const due = [...document.querySelectorAll('button')].find(x=>/Review Due/i.test(x.innerText));
    if (due) { due.click(); return 'Review Due'; }
    const row = document.querySelector('aside button');
    if (row) { row.click(); return 'queue row'; }
    return 'nothing';
  })()`);
  await sleep(7000);
  const rv = await measure();
  show(`REVIEW (started via ${started})`, rv);
  await shot(`cmp-${tag}-review`);

  // --- numeric diff ---
  console.log(`\n  DIFF training vs review @${tag}:`);
  for (const k of ["board", "head", "movenav", "foot", "strip"]) {
    const a = tr[k], b = rv[k];
    const same = (a?.w === b?.w && a?.h === b?.h);
    console.log(`    ${k.padEnd(8)} ${same ? "IDENTICAL" : "DIFFERENT"}  training=${a ? a.w + "x" + a.h : "none"}  review=${b ? b.w + "x" + b.h : "none"}`);
  }
}

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
console.log(`\nuncaught exceptions: ${errs.length}`);
ws.close(); process.exit(0);
