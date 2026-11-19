/** Probe: why is sync not pushing from the rescue profile? */
import { WebSocket } from "ws";

const list = await (await fetch("http://localhost:9247/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Runtime.enable");

console.log("URL:", await ev("location.href"));
console.log("sync flag:", JSON.stringify(await ev("localStorage.getItem('puzzle_trainer_sync')")));

const clock = await ev("localStorage.getItem('puzzle_trainer___sync_clock')");
console.log("clock:", clock ? `yes, ${Object.keys(JSON.parse(clock)).length} keys` : "NO — pullState never ran");
if (clock) console.log("  entries:", Object.keys(JSON.parse(clock)).slice(0, 14).join(", "));

const probe = await ev(`fetch('/api/state', {cache:'no-store'}).then(r => r.text().then(t => r.status + ' :: ' + t.slice(0,100)))`);
console.log("GET /api/state ->", probe);

const put = await ev(`(async () => {
  try {
    const r = await fetch('/api/state', { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ 'puzzle_trainer_sync_probe': { v: 'hello', t: Date.now() } }) });
    return 'PUT ' + r.status + ' :: ' + (await r.text()).slice(0,140);
  } catch (e) { return 'PUT threw: ' + e.message; }
})()`);
console.log("manual PUT ->", put);

ws.close();
