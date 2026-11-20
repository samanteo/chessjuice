/**
 * Does a commit SURVIVE a reload? (rating, attempts, review queue, streak)
 *
 * REWRITTEN. The previous version was not a valid test:
 *   - it seeded NOTHING and relied on "the browser still holds the state from the
 *     previous solve", so its result depended on which test happened to run before
 *     it — including the dead giveaway that it read `puzzle_trainer_attempts`
 *     straight out of localStorage and asserted it was > 0;
 *   - it hardcoded `settingsRating > 1500`. The real rating is ~1229, so it failed
 *     for a user whose rating is simply below an arbitrary line;
 *   - it asserted the rendered text matched /Streak:\s*(\d+)/, which is stale
 *     (the UI renders `{streak} 🔥`, so that regex can never match the streak).
 * Its three "failures" were its own assumptions, not app bugs.
 *
 * This version seeds a KNOWN state before the app boots, reloads, and asserts the
 * exact values are still there. That tests the thing that actually matters: that
 * booting the app does not reset or rewrite persisted progress.
 *
 * Harness safety: `puzzle_trainer_sync='off'` is installed via
 * Page.addScriptToEvaluateOnNewDocument BEFORE any page script runs, on every
 * document, so nothing here is pulled from or pushed to the real /api/state store.
 * Never calls DELETE /api/state.
 */
import { WebSocket } from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch("http://localhost:9245/json/list")).json();
const p = list.find((t) => t.type === "page");
const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// A KNOWN state, seeded once. Deliberately NOT above any arbitrary threshold:
// rating 1734 and streak 7 are just values that must come back unchanged.
const SEED = {
  attempts: [
    { puzzleId: "XqDh6", userId: "local_harness", result: "incorrect", ratingAfter: 1700, timestamp: "2026-11-20T10:00:00.000Z" },
    { puzzleId: "XqDh6", userId: "local_harness", result: "correct", ratingAfter: 1720, timestamp: "2026-11-20T10:05:00.000Z" },
    { puzzleId: "abc12", userId: "local_harness", result: "correct", ratingAfter: 1734, timestamp: "2026-11-20T10:10:00.000Z" },
  ],
  progress: { XqDh6: { rg: 1, due: "2026-12-01T00:00:00.000Z", wr: 1, at: "2026-11-20T10:05:00.000Z" } },
  settings: { rating: 1734, streak: 7 },
};

await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    try { localStorage.setItem('puzzle_trainer_sync','off'); } catch (e) {}
    // Seed only once, so the reload genuinely tests persistence rather than re-seeding.
    try {
      if (!localStorage.getItem('__persist_seeded')) {
        localStorage.setItem('__persist_seeded','1');
        localStorage.setItem('puzzle_trainer_attempts', ${JSON.stringify(JSON.stringify(SEED.attempts))});
        localStorage.setItem('puzzle_trainer_progress_v2', ${JSON.stringify(JSON.stringify(SEED.progress))});
        localStorage.setItem('puzzle_trainer_settings', ${JSON.stringify(JSON.stringify(SEED.settings))});
      }
    } catch (e) {}
  `,
});
// Clear the sentinel on the current document, then load, so the seed definitely applies.
await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
await evalJs(`localStorage.removeItem('__persist_seeded')`);

const read = () => evalJs(`(() => {
  const s = JSON.parse(localStorage.getItem('puzzle_trainer_settings') || '{}');
  return {
    attempts: (JSON.parse(localStorage.getItem('puzzle_trainer_attempts') || '[]')).length,
    progress: Object.keys(JSON.parse(localStorage.getItem('puzzle_trainer_progress_v2') || '{}')).length,
    rating: s.rating ?? null,
    streak: s.streak ?? null,
  };
})()`);

await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(14000);
const before = await read();
console.log("BEFORE reload:", JSON.stringify(before));

await send("Page.navigate", { url: "http://localhost:3000/?cb=" + Date.now() });
await sleep(16000);
const after = await read();
console.log("AFTER  reload:", JSON.stringify(after));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

ok(before.attempts === SEED.attempts.length, `the seeded state was actually in place before the reload (${before.attempts} attempts)`);
ok(after.attempts === before.attempts, `attempts survive a reload (${before.attempts} -> ${after.attempts})`);
ok(after.progress === before.progress, `the review queue survives a reload (${before.progress} -> ${after.progress})`);
ok(after.rating === SEED.settings.rating, `rating survives a reload (want ${SEED.settings.rating}, got ${after.rating})`);
ok(after.streak === SEED.settings.streak, `streak survives a reload (want ${SEED.settings.streak}, got ${after.streak})`);
// The point of the whole file: booting the app must not WIPE persisted progress.
ok(after.attempts > 0 && after.rating !== null,
   `booting the app does not reset persisted progress`);

console.log(`\n  PASS ${pass}   FAIL ${fail}`);
ws.close();
process.exit(fail ? 1 : 0);
