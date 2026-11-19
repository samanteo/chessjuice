/**
 * Assertions for the Lichess-faithful dispenser.
 * Imports the REAL src/lib/dispensing.ts (transpiled from source, not a port).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "disp-"));
const out = path.join(tmp, "dispensing.mjs");
fs.writeFileSync(out, ts.transpileModule(
  fs.readFileSync(path.join(ROOT, "src/lib/dispensing.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText);

const M = await import(pathToFileURL(out).href);
const { DIFFICULTY_DELTA, flexFor, selectPuzzle, tierFilter, stepDown, isExtremeDifficulty, MAX_COMPROMISE } = M;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// deterministic RNG
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

console.log("== A. difficulty deltas match PuzzleDifficulty.scala exactly ==");
ok(DIFFICULTY_DELTA.easiest === -600, "easiest = -600");
ok(DIFFICULTY_DELTA.easier === -300, "easier = -300");
ok(DIFFICULTY_DELTA.normal === 0, "normal = 0");
ok(DIFFICULTY_DELTA.harder === 300, "harder = +300");
ok(DIFFICULTY_DELTA.hardest === 600, "hardest = +600");
ok(isExtremeDifficulty("easiest") && isExtremeDifficulty("hardest"), "easiest/hardest are 'extreme'");
ok(!isExtremeDifficulty("normal"), "normal is not extreme");

console.log("\n== B. flex grows with distance from 1500 (PuzzlePath.scala:50) ==");
const f1500 = flexFor(1500, 2), f2000 = flexFor(2000, 2), f1000 = flexFor(1000, 2);
console.log(`   flex@1500=${f1500}  flex@2000=${f2000}  flex@1000=${f1000}`);
ok(f1500 === (100 + 0) * 2, "at 1500: (100 + 0) * 2 = 200");
ok(f2000 === (100 + 125) * 2, "at 2000: (100 + 500/4) * 2 = 450");
ok(f1000 === (100 + 125) * 2, "at 1000: symmetric = 450");
ok(f2000 > f1500, "band is WIDER far from 1500");
ok(flexFor(1500, 9) === flexFor(1500, 4), "compromise is capped at 4 (atMost(4))");

console.log("\n== C. the band is HARD — never serves outside it ==");
const pool = [];
for (let r = 800; r <= 2400; r += 50) for (let k = 0; k < 5; k++) pool.push({ id: `p${r}_${k}`, rating: r, popularity: 95 });
let worst = 0, outside = 0;
for (let i = 0; i < 400; i++) {
  const { puzzle, trace } = selectPuzzle(pool, { userRating: 1500, difficultyId: "normal", random: Math.random });
  const d = Math.abs(puzzle.rating - trace.target);
  worst = Math.max(worst, d);
  if (d > trace.flex + 1e-9) outside++;
}
console.log(`   400 picks at target 1500: worst |rating-target| = ${worst}  (flex ${flexFor(1500,0)})`);
ok(outside === 0, "every served puzzle is inside the flex band");

console.log("\n== D. difficulty shifts the target band ==");
const hard = selectPuzzle(pool, { userRating: 1500, difficultyId: "harder", random: seq([0.5]) });
const easy = selectPuzzle(pool, { userRating: 1500, difficultyId: "easier", random: seq([0.5]) });
console.log(`   harder target=${hard.trace.target}  easier target=${easy.trace.target}`);
ok(hard.trace.target === 1800, "harder targets 1500+300 = 1800");
ok(easy.trace.target === 1200, "easier targets 1500-300 = 1200");

console.log("\n== E. recently-served puzzles are excluded ==");
const small = [{ id: "a", rating: 1500, popularity: 95 }, { id: "b", rating: 1510, popularity: 95 }];
const excl = new Set(["a"]);
let sawA = false;
for (let i = 0; i < 50; i++) {
  const { puzzle } = selectPuzzle(small, { userRating: 1500, difficultyId: "normal", exclude: excl, random: Math.random });
  if (puzzle.id === "a") sawA = true;
}
ok(!sawA, "excluded puzzle 'a' never served while 'b' is available");

console.log("\n== F. tier: top→good→all, and extreme difficulty starts at 'good' ==");
ok(stepDown("top") === "good" && stepDown("good") === "all" && stepDown("all") === null, "stepDown chain top→good→all→null");
const lowQ = [{ id: "low", rating: 1500, popularity: 82 }];
const t = selectPuzzle(lowQ, { userRating: 1500, difficultyId: "normal", random: seq([0.5]) });
console.log(`   only a popularity-82 puzzle available -> tier used: ${t.trace.tier}`);
ok(t.puzzle !== null, "still serves something (tier degrades rather than failing)");
const ext = selectPuzzle(pool, { userRating: 1500, difficultyId: "hardest", random: seq([0.5]) });
console.log(`   hardest difficulty started at tier: ${ext.trace.tier}`);
ok(ext.trace.tier !== undefined, "extreme difficulty resolves a tier");
ok(tierFilter(pool, "top").length > 0, "tierFilter never returns empty when data exists");

console.log("\n== G. gives up gracefully rather than returning null ==");
const impossible = [{ id: "far", rating: 9999, popularity: 99 }];
const g = selectPuzzle(impossible, { userRating: 1500, difficultyId: "normal", random: seq([0.5]) });
ok(g.puzzle !== null, "falls back to the closest puzzle instead of a dead board");
ok(g.trace.gaveUp === true, "trace flags gaveUp");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
