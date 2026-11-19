/**
 * The catalogue now carries each puzzle's REAL Glicko rating deviation (Lichess
 * derives it server-side; our SQLite has `rating_deviation`, clustered 74-83).
 * Assert it is actually USED instead of the old fixed assumption.
 *
 * Transpiles the real src/lib sources, same as verify-rating-integration.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src", "lib");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "real-rd-"));

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    fileName: file,
  }).outputText;
}

fs.writeFileSync(path.join(outDir, "glicko2.mjs"), transpile(path.join(SRC, "glicko2.ts")));
fs.writeFileSync(
  path.join(outDir, "themeRatings.mjs"),
  transpile(path.join(SRC, "themeRatings.ts")).replace(/from\s+["']\.\/glicko2["']/g, 'from "./glicko2.mjs"'),
);
fs.writeFileSync(
  path.join(outDir, "ratingPipeline.mjs"),
  transpile(path.join(SRC, "ratingPipeline.ts"))
    .replace(/from\s+["']\.\/glicko2["']/g, 'from "./glicko2.mjs"')
    .replace(/from\s+["']\.\/themeRatings["']/g, 'from "./themeRatings.mjs"'),
);

const R = await import(pathToFileURL(path.join(outDir, "ratingPipeline.mjs")).href);
const { applyPuzzleResult, initialRatingState, PUZZLE_DEVIATION } = R;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const base = { themes: ["fork"], result: "correct", hintUsed: false, solutionViewed: false };
const fresh = () => initialRatingState(1500);

console.log("== A. the fallback constant is unchanged ==");
ok(PUZZLE_DEVIATION === 80, `PUZZLE_DEVIATION === 80 (${PUZZLE_DEVIATION})`);

console.log("\n== B. a real RD is actually used ==");
const withFallback = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1500 });
const withReal = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1500, puzzleDeviation: 75 });
console.log(`   delta fallback(RD=80) = ${withFallback.delta.toFixed(3)}`);
console.log(`   delta real(RD=75)     = ${withReal.delta.toFixed(3)}`);
ok(withReal.delta !== withFallback.delta, "a real RD changes the rating delta");
ok(withReal.delta < withFallback.delta, "lower opponent RD (75 < 80) => smaller win delta");

console.log("\n== C. higher RD (less certain opponent) => bigger delta ==");
const highRD = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1500, puzzleDeviation: 300 });
console.log(`   delta RD=300 = ${highRD.delta.toFixed(3)}`);
ok(highRD.delta > withFallback.delta, "higher opponent RD => larger win delta");

console.log("\n== D. absent / invalid RD falls back to the constant ==");
for (const [label, v] of [["null", null], ["undefined", undefined], ["0", 0], ["negative", -5], ["NaN", NaN]]) {
  const d = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1500, puzzleDeviation: v }).delta;
  ok(d === withFallback.delta, `${label} -> fallback (delta ${d.toFixed(3)})`);
}

console.log("\n== E. real catalogue RDs (74-83) are a small correction, not a rewrite ==");
for (const rd of [74, 77, 80, 83]) {
  const r = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1600, puzzleDeviation: rd });
  console.log(`   RD=${rd}  delta=${r.delta.toFixed(3)}`);
}
const d74 = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1600, puzzleDeviation: 74 }).delta;
const d83 = applyPuzzleResult(fresh(), { ...base, puzzleRating: 1600, puzzleDeviation: 83 }).delta;
ok(Math.abs(d74 - d83) < 1.5, `spread across the real RD band is small (${Math.abs(d74 - d83).toFixed(3)} rating)`);

console.log("\n== F. losses move the other way with a real RD ==");
const loss = { ...base, result: "incorrect", puzzleRating: 1600, puzzleDeviation: 77 };
const lossApplied = applyPuzzleResult(fresh(), loss);
console.log(`   loss delta = ${lossApplied.delta.toFixed(3)}`);
ok(lossApplied.delta < 0, "a wrong solve still decreases the rating");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
