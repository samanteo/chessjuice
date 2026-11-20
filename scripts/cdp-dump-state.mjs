/** Dump the raw persisted rating state after a commit. */
import { WebSocket } from "ws";
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

// --- HARNESS ISOLATION GUARD (best-effort) -----------------------------------
// This script does not navigate, so it can only run against an ALREADY-LOADED
// page and cannot pre-seed the flag before boot. It flips the sync opt-out now so
// no pending write from that page is pushed to the user's real /api/state store
// while we read it.
await send("Runtime.enable");
await ev(`try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}`);


console.log("glicko raw      :", (await ev(`localStorage.getItem('puzzle_trainer_glicko_v1')`) ?? "null").slice(0, 300));
console.log("progress raw    :", (await ev(`localStorage.getItem('puzzle_trainer_progress_v2')`) ?? "null").slice(0, 300));
console.log("settings.rating :", await ev(`JSON.parse(localStorage.getItem('puzzle_trainer_settings')||'{}').rating`));
console.log("ui 'Your rating':", await ev(`(document.querySelector('main').innerText.match(/Your rating:\\s*\\n?\\s*(\\d{3,4})/)??[])[1]`));
console.log("glicko keys     :", await ev(`(() => { const g = localStorage.getItem('puzzle_trainer_glicko_v1'); if(!g) return 'none'; const o = JSON.parse(g); return JSON.stringify(Object.keys(o)) + ' overall=' + JSON.stringify(o.overall); })()`));
ws.close();
process.exit(0);
