/**
 * What does the Analytics tab ACTUALLY render right now?
 * Checks for the old replay control vs the new history panels.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch("http://localhost:9245/json/list")).json();
      const p = list.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("no CDP page target");
}
const ws = new WebSocket(await target(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
let id = 0; const pending = new Map(); const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });   // defeat any cached bundle
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

console.log("hard-navigating with cache disabled…");
await send("Page.navigate", { url: "http://localhost:3000/?cachebust=" + Date.now() });
await sleep(16000);

// go to Analytics
await evalJs(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>/Analytics/i.test(x.innerText)); b&&b.click(); })()`);
await sleep(8000);

const out = await evalJs(`({
  tabLabels: [...document.querySelectorAll('nav button')].map(b=>b.innerText.replace(/\\n/g,' ').trim()).filter(Boolean).slice(0,5),
  oldReplayTestId: !!document.querySelector('[data-testid="to-replay"]'),
  oldReplayText: /\\bto replay\\b/i.test(document.body.innerText),
  historyPanelsWrap: !!document.querySelector('[data-testid="history-panels"]'),
  historyAll: !!document.querySelector('[data-testid="history-all-panel"]'),
  historyToday: !!document.querySelector('[data-testid="history-today-panel"]'),
  replayAllBtn: !!document.querySelector('[data-testid="history-all-replay"]'),
  replayTodayBtn: !!document.querySelector('[data-testid="history-today-replay"]'),
  calendarHeatmap: !!document.querySelector('[data-testid="calendar-heatmap"]'),
  heatmapCard: !!document.querySelector('[data-testid="activity-heatmap"]'),
  hasHistoryWord: /Puzzle history/i.test(document.body.innerText),
  hasTodayWord: /Today/i.test(document.body.innerText),
  bodyStart: document.body.innerText.replace(/\\n+/g,' | ').slice(0,260),
})`);
console.log(JSON.stringify(out, null, 1));

const errs = events.filter((e) => e.method === "Runtime.exceptionThrown");
console.log("exceptions:", errs.length);
errs.slice(0,3).forEach(e => console.log("  !", (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0,200)));
ws.close();
process.exit(0);
