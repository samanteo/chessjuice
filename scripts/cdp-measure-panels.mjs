/** Measure where the history panels sit vertically on the Analytics tab. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

// make sure we are on Analytics
await ev(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(7000);

const out = await ev(`(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) }; };
  return {
    pageHeight: Math.round(document.body.scrollHeight),
    viewport: window.innerHeight,
    panels: rect('[data-testid="history-panels"]'),
    heatmap: rect('[data-testid="activity-heatmap"]'),
    historyAll: rect('[data-testid="history-all-panel"]'),
    historyToday: rect('[data-testid="history-today-panel"]'),
    screensDownToPanels: rect('[data-testid="history-panels"]') ? Math.round((rect('[data-testid="history-panels"]').top) / window.innerHeight * 10) / 10 : null,
  };
})()`);
console.log(JSON.stringify(out, null, 1));
ws.close();
process.exit(0);
