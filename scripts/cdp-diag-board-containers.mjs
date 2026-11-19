/** What sits ABOVE the board in each tab, and how the containers differ. */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://localhost:9245/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 29 });
await new Promise((r) => ws.once("open", r));
let id = 0; const p = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const click = (re) => ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.innerText||'').trim())&&x.offsetParent!==null); if(!b)return false; b.click(); return true; })()`);

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const probe = (ctx) => ev(`(() => {
  const rr = (e) => { if(!e) return null; const b=e.getBoundingClientRect(); return {y:Math.round(b.y),h:Math.round(b.height),w:Math.round(b.width),x:Math.round(b.x)}; };
  const panel = document.querySelector('[data-board-context="${ctx}"]');
  // Walk up from the board panel and report each ancestor's box + classes.
  const chain = [];
  let el = panel;
  while (el && el !== document.body) {
    chain.push({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class')||'').slice(0,90), box: rr(el) });
    el = el.parentElement;
  }
  const wrapper = panel && panel.closest('[data-testid$="-board"]');
  return {
    scrollY: Math.round(window.scrollY),
    panel: rr(panel),
    wrapper: wrapper ? { testid: wrapper.getAttribute('data-testid'), box: rr(wrapper) } : null,
    chain,
    // Anything rendered above the board inside the page?
    above: [...document.querySelectorAll('main *, body > div > *')]
      .filter(e => { const b=e.getBoundingClientRect(); const pb=panel?panel.getBoundingClientRect():null;
        return pb && b.bottom <= pb.top + 2 && b.height > 8 && e.offsetParent !== null; })
      .slice(0,8).map(e => ({ tag:e.tagName.toLowerCase(), cls:(e.getAttribute('class')||'').slice(0,60),
                              txt:(e.innerText||'').trim().slice(0,40), box:rr(e) })),
  };
})()`);

await send("Page.navigate", { url: "http://localhost:3000/?a=" + Date.now() });
await sleep(12000);
await ev(`localStorage.clear(); localStorage.setItem('puzzle_trainer_sync','off');
          localStorage.setItem('puzzle_trainer_pinned_themes', JSON.stringify(['fork']));`);
await send("Page.navigate", { url: "http://localhost:3000/?b=" + Date.now() });
await sleep(15000);

await click(/Quick start/i);
await sleep(9000);
const tr = await probe("training");
console.log("===== TRAINING =====");
console.log("scrollY:", tr.scrollY, " wrapper:", JSON.stringify(tr.wrapper));
console.log("panel:", JSON.stringify(tr.panel));
console.log("-- ancestor chain (board -> body) --");
for (const c of tr.chain) console.log(`   ${c.tag.padEnd(6)} ${String(c.box.y).padStart(5)} h=${String(c.box.h).padStart(5)} w=${String(c.box.w).padStart(5)}  ${c.cls}`);
console.log("-- elements above the board --");
for (const a of tr.above) console.log(`   ${a.tag.padEnd(6)} y=${String(a.box.y).padStart(5)} h=${String(a.box.h).padStart(4)}  "${a.txt}"  ${a.cls}`);

await click(/^Solution$/i);
await sleep(4000);
await ev(`document.querySelector('[data-testid="tab-mistakes"]')?.click()`);
await sleep(2500);
await click(/Review Due/i);
await sleep(5000);
const rv = await probe("review");
console.log("\n===== REVIEW =====");
console.log("scrollY:", rv.scrollY, " wrapper:", JSON.stringify(rv.wrapper));
console.log("panel:", JSON.stringify(rv.panel));
console.log("-- ancestor chain (board -> body) --");
for (const c of rv.chain) console.log(`   ${c.tag.padEnd(6)} ${String(c.box.y).padStart(5)} h=${String(c.box.h).padStart(5)} w=${String(c.box.w).padStart(5)}  ${c.cls}`);
ws.close();
