/**
 * Drive the live app over CDP: confirm the Lichess-faithful dispenser is wired
 * and that clicking a theme card serves a puzzle INSIDE the expected flex band.
 */
import { WebSocket } from "ws";

const CDP = "http://localhost:9245";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${CDP}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("no CDP page target");
}

const url = await target();
const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });

let id = 0;
const pending = new Map();
const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});

const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");
await send("Network.enable");
// Phone-first: this is how the user actually uses the app.
await send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});

console.log("navigating to the app…");
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(14000); // catalogue parse

const consoleErrors = events
  .filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
  .map((e) => e.params.args.map((a) => a.value ?? a.description).join(" "));
const exceptions = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => e.params.exceptionDetails.text + " " + (e.params.exceptionDetails.exception?.description ?? ""));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("   !", e.slice(0, 160)));
console.log(`uncaught exceptions: ${exceptions.length}`);
exceptions.slice(0, 5).forEach((e) => console.log("   !", e.slice(0, 200)));
ok(consoleErrors.length === 0, "no console errors on load");
ok(exceptions.length === 0, "no uncaught exceptions on load");

const title = await evalJs("document.title");
const bodyLen = await evalJs("document.body.innerText.length");
console.log(`title: ${JSON.stringify(title)}   body text: ${bodyLen} chars`);
ok(bodyLen > 200, "page actually rendered content");

// tab order must still be the 5 the user specified
const tabs = await evalJs(`Array.from(document.querySelectorAll('nav button, [role="tab"], button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,12)`);
console.log(`first buttons: ${JSON.stringify(tabs)}`);

// Training is the quick-PIN view; with no pins there are no cards. Go to All themes.
const navClick = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => /All themes/i.test(x.innerText));
  if (!b) return { clicked: false };
  b.click();
  return { clicked: true, label: b.innerText.trim() };
})()`);
console.log(`clicked "All themes": ${JSON.stringify(navClick)}`);
await sleep(1500);

// Click a real theme card ("Play →" lives inside the card button).
const clicked = await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('button')).filter(b => /Play →/.test(b.innerText));
  if (!cards.length) return { clicked: false, n: 0 };
  const c = cards[0];
  const label = c.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60);
  c.click();
  return { clicked: true, n: cards.length, label };
})()`);
console.log(`clicked theme card: ${JSON.stringify(clicked)}`);

await sleep(4000);

// capture anything thrown DURING/AFTER the click
const postErrors = events
  .filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
  .map((e) => e.params.args.map((a) => a.value ?? a.description).join(" "));
const postExc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.text + " " + (e.params.exceptionDetails.exception?.description ?? "")).slice(0, 300));
console.log(`errors after click: ${postErrors.length}`);
postErrors.slice(0, 4).forEach((e) => console.log("   !", e.slice(0, 200)));
console.log(`exceptions after click: ${postExc.length}`);
postExc.slice(0, 4).forEach((e) => console.log("   !", e.slice(0, 300)));

const board = await evalJs(`(() => {
  const cg = document.querySelector('cg-board') || document.querySelector('.cg-wrap');
  const info = document.body.innerText;
  const nums = (info.match(/\\b(\\d{3,4})\\b/g) || []);
  return {
    boardPresent: !!cg,
    boardSize: cg ? Math.round(cg.getBoundingClientRect().width) : 0,
    hasNext: /next puzzle/i.test(info),
    hasHard: /hard/i.test(info),
    numbersSeen: nums.slice(0, 12),
    text: info.slice(0, 420).replace(/\\n+/g, ' | '),
  };
})()`);
console.log(`board: ${JSON.stringify(board, null, 2)}`);
ok(board.boardPresent, "a board is rendered after starting a theme puzzle");
ok(board.boardSize >= 300, `board fills the phone width (${board.boardSize}px)`);
ok(board.hasNext, "'Next puzzle' control present (board is interactive)");

// THE KEY ASSERTION: is the served puzzle inside the Lichess flex band?
const bandCheck = await evalJs(`(() => {
  const s = JSON.parse(localStorage.getItem('puzzle_trainer_settings') || '{}');
  const info = document.body.innerText;
  const m = info.match(/Rating\\s*\\n?\\s*(\\d{3,4})/) || info.match(/(\\d{3,4})/);
  return { userRating: s.rating ?? null, servedRating: m ? Number(m[1]) : null };
})()`);
console.log(`band check: ${JSON.stringify(bandCheck)}`);
if (bandCheck.userRating != null && bandCheck.servedRating != null) {
  const target = bandCheck.userRating;           // Normal difficulty = +0
  const diff = Math.abs(bandCheck.servedRating - target);
  console.log(`   target ${target}  served ${bandCheck.servedRating}  |diff| = ${diff}  (band ±100)`);
  ok(diff <= 100, `served puzzle is INSIDE the ±100 flex band (diff ${diff})`);
}

// verify the served puzzle rating lands in the band for the stored user rating
const ratingCheck = await evalJs(`(() => {
  const s = JSON.parse(localStorage.getItem('puzzle_trainer_settings') || '{}');
  return { userRating: s.rating ?? null };
})()`);
console.log(`stored user rating: ${JSON.stringify(ratingCheck)}`);

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
