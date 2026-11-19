/**
 * Verify the Review tab's "Group by theme" toggle:
 *  - off by default, flat list
 *  - on -> items batched by angle, group headers show labels + counts
 *  - the same items are present either way (grouping reorders, never drops)
 *  - no overflow
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(13000);

// Seed 6 due mistakes: some WITH a real opening, some without (=> "Mixed").
// NOTE: /api/puzzles has no `opening` filter, so sample broadly and partition on
// the returned `openings` field rather than asking for an opening directly.
const withOpening = [], noOpening = [];
for (let i = 0; i < 6 && (withOpening.length < 3 || noOpening.length < 3); i++) {
  const res = await fetch("http://localhost:3000/api/puzzles?limit=100");
  const rows = await res.json();
  for (const r of rows) {
    const has = (r.openings ?? []).length > 0;
    if (has && withOpening.length < 3) withOpening.push(r);
    else if (!has && noOpening.length < 3) noOpening.push(r);
  }
}
const all = [...withOpening, ...noOpening];
console.log(`seeded: ${withOpening.length} with openings (${withOpening.map(r=>r.openings[0]).join(", ")}), ${noOpening.length} without`);
if (all.length < 4) { console.log("not enough seed data"); process.exit(1); }

const now = Date.now();
const progress = {};
for (const r of all) {
  progress[r.id] = { rg: 0, wr: 1, at: 1, co: 0, due: new Date(now - 60000).toISOString(), lr: new Date(now - 3600000).toISOString(), iw: 1 };
}
// attempts carry the openings so the angle is derivable client-side
const attempts = all.map((r, i) => ({
  puzzleId: r.id, userId: "local", result: "incorrect", moveNumber: 1, timeSpent: 4000,
  hintUsed: false, solutionViewed: false, ratingBefore: 1500, ratingAfter: 1490,
  timestamp: new Date(now - 3600000 * (i + 1)).toISOString(),
  puzzleRating: r.rating, themes: r.themes, openings: r.openings ?? [],
}));
await evalJs(`localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(progress))})`);
await evalJs(`localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(attempts))})`);

events.length = 0;
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(15000);
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Review/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(5000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const read = async () => evalJs(`(() => {
  const main = document.querySelector('main');
  const grouped = document.querySelector('[data-testid="queue-grouped"]');
  const toggle = document.querySelector('[data-testid="queue-group-toggle"]');
  const items = [...main.querySelectorAll('[data-testid^="queue-item-"]')];
  const ids = items.map(e=>e.getAttribute('data-testid')).sort();
  const groups = [...document.querySelectorAll('[data-testid^="queue-group-"]')]
    .filter(e=>e.getAttribute('data-testid')!=='queue-group-toggle')
    .map(e=>({ id:e.getAttribute('data-testid'), label:e.querySelector('span')?.innerText||'', count:e.querySelectorAll('[data-testid^="queue-item-"]').length }));
  const bad = [...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+8&&e.clientWidth>60);
  return { toggleOn: toggle?.getAttribute('data-on'), groupedRendered: !!grouped, groupCount: groups.length, groups: groups.slice(0,6), ids, overflow: bad.length };
})()`);

const off = await read();
console.log("OFF:", JSON.stringify({ toggleOn: off.toggleOn, grouped: off.groupedRendered, items: off.ids.length }));
ok(off.toggleOn === "0", "toggle is OFF by default");
ok(!off.groupedRendered, "flat list renders when grouping is off");
// Guard against the vacuous pass: the item selector must actually find rows.
ok(off.ids.length === all.length, `flat list shows all seeded rows (${off.ids.length}/${all.length})`);

await evalJs(`document.querySelector('[data-testid="queue-group-toggle"]').click()`);
await sleep(1200);
const on = await read();
console.log("ON:", JSON.stringify({ toggleOn: on.toggleOn, grouped: on.groupedRendered, groups: on.groups }));
ok(on.toggleOn === "1", "toggle flips ON");
ok(on.groupedRendered, "grouped view renders");
ok(on.groupCount >= 2, `multiple angle groups (${on.groupCount})`);
ok(on.groups.some(g=>/Sicilian/i.test(g.label)), "a real opening label appears");
ok(on.groups.some(g=>/Mixed/i.test(g.label)), "'Mixed' group for puzzles with no opening");
ok(JSON.stringify(on.ids) === JSON.stringify(off.ids), `grouping reorders, never drops (${on.ids.length} items both ways)`);
ok(on.overflow === 0, `no overflow while grouped (${on.overflow})`);

// toggle back
await evalJs(`document.querySelector('[data-testid="queue-group-toggle"]').click()`);
await sleep(900);
const back = await read();
ok(back.toggleOn === "0" && !back.groupedRendered, "toggling off returns to the flat list");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown");
ok(errs.length === 0, `no uncaught exceptions (${errs.length})`);
errs.slice(0,3).forEach(e=>console.log("   !", (e.params.exceptionDetails.exception?.description??"").slice(0,180)));

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
ws.close();
process.exit(fail ? 1 : 0);
