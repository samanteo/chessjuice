// INDEPENDENT verification of the Glicko-2 wiring — parent-authored assertions,
// driving the REAL src/lib/ratingPipeline.ts (transpiled from source, not a port).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src", "lib");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glicko-indep-"));

function transpile(file, name) {
  const out = path.join(tmp, name);
  fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  return out;
}
transpile(path.join(SRC, "glicko2.ts"), "glicko2.mjs");
let tp = fs.readFileSync(transpile(path.join(SRC, "themeRatings.ts"), "themeRatings.mjs"), "utf8")
  .replace(/from\s+["']\.\/glicko2["']/g, 'from "./glicko2.mjs"');
fs.writeFileSync(path.join(tmp, "themeRatings.mjs"), tp);
tp = fs.readFileSync(transpile(path.join(SRC, "ratingPipeline.ts"), "ratingPipeline.mjs"), "utf8")
  .replace(/from\s+["']\.\/glicko2["']/g, 'from "./glicko2.mjs"')
  .replace(/from\s+["']\.\/themeRatings["']/g, 'from "./themeRatings.mjs"');
fs.writeFileSync(path.join(tmp, "ratingPipeline.mjs"), tp);

const { applyPuzzleResult, initialRatingState, isCleanWin, shouldFlushSession, SESSION_WINDOW, PUZZLE_DEVIATION } =
  await import(pathToFileURL(path.join(tmp, "ratingPipeline.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };
const apply = (st, input) => applyPuzzleResult(st, input);

console.log(`PUZZLE_DEVIATION=${PUZZLE_DEVIATION}  SESSION_WINDOW=${SESSION_WINDOW}`);

// [1] provisional player must move far more than a flat +/-10
const w = apply(initialRatingState(1500), { puzzleRating: 1400, themes: ["fork"], result: "correct" });
console.log(`\n[1] clean win vs 1400: ${w.before.rating.toFixed(2)} -> ${w.after.rating.toFixed(2)} (delta ${w.delta.toFixed(2)}, RD ${w.before.deviation.toFixed(1)} -> ${w.after.deviation.toFixed(1)})`);
ok(Math.abs(w.delta) > 20, `provisional delta ${w.delta.toFixed(2)} > 20 — flat +/-10 impossible`);
ok(w.delta !== 10 && w.delta !== -10, "delta is not exactly +/-10");
ok(w.delta > 0, "clean win increases rating");

// [2] loss decreases
const l = apply(initialRatingState(1500), { puzzleRating: 1400, themes: ["fork"], result: "incorrect" });
console.log(`\n[2] wrong solve delta: ${l.delta.toFixed(2)}`);
ok(l.delta < 0, "wrong solve decreases rating");

// [3] HARD is a loss
const hd = apply(initialRatingState(1500), { puzzleRating: 1400, themes: ["fork"], result: "hard" });
console.log(`\n[3] HARD delta: ${hd.delta.toFixed(2)}  (scored=${hd.scored})`);
ok(hd.delta < 0, "HARD decreases rating (loss, not a win)");

// [4] hint / solution are not clean wins
console.log("\n[4] cleanWin:");
ok(isCleanWin("correct", false, false), "clean correct = win");
ok(!isCleanWin("correct", true, false), "hint-assisted != win");
ok(!isCleanWin("correct", false, true), "solution-viewed != win");
const h = apply(initialRatingState(1500), { puzzleRating: 1400, themes: ["fork"], result: "correct", hintUsed: true });
ok(h.delta <= 0, `hint-assisted correct gains nothing (delta ${h.delta.toFixed(2)})`);

// [5] established moves less than provisional
let est = initialRatingState(1500);
for (let i = 0; i < 60; i++) est = apply(est, { puzzleRating: 1500, themes: ["fork"], result: i % 2 ? "correct" : "incorrect" }).state;
const e2 = apply(est, { puzzleRating: 1500, themes: ["fork"], result: "correct" });
console.log(`\n[5] established (RD ${est.overall.deviation.toFixed(1)}) delta ${e2.delta.toFixed(2)} vs provisional ${w.delta.toFixed(2)}`);
ok(Math.abs(e2.delta) < Math.abs(w.delta), "established moves less than provisional (Glicko shape)");

// [6] multi-theme attribution
const multi = apply(initialRatingState(1500), { puzzleRating: 1400, themes: ["fork", "pin", "mateIn2"], result: "correct" });
const touched = Object.keys(multi.state.themes).filter(k => multi.state.themes[k].played > 0);
console.log("\n[6] themes touched by ['fork','pin','mateIn2']:", touched.join(", "));
ok(["fork", "pin", "mateIn2"].every(t => touched.includes(t)), "every carried theme updated (Unwind behaviour)");

// [7] session window
console.log("\n[7] +/-100 window:");
ok(!shouldFlushSession(1600, 1500), "delta 100 -> no flush");
ok(shouldFlushSession(1601, 1500), "delta 101 -> flush");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
