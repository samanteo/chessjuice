/** Dump the Training tab's rendered text + theme card counts. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

// --- HARNESS ISOLATION GUARD (best-effort) -----------------------------------
// No navigation here, so we run against an ALREADY-LOADED page and cannot
// pre-seed the flag before boot. Opt out of sync now so nothing is pushed to the
// user's real /api/state store while we read.
await send("Runtime.enable");
await evalJs(`try{localStorage.setItem('puzzle_trainer_sync','off')}catch(e){}`);


const t = await evalJs(`document.querySelector('main')?.innerText ?? document.body.innerText`);
console.log("=== MAIN TEXT (first 2500 chars) ===");
console.log(t.slice(0, 2500));
console.log("\n=== theme-card counts ===");
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('[data-testid*="theme-card"],[class*="theme"]')].slice(0,8).map(e=>e.innerText.replace(/\\n/g,' | ')))`));
console.log("\n=== localStorage catalog-related keys ===");
console.log(await evalJs(`JSON.stringify(Object.keys(localStorage))`));
ws.close();
process.exit(0);
