/**
 * Runnable proof that the FLAT ±10 is gone and real Glicko-2 is wired in.
 *
 *   node scripts/verify-rating-integration.mjs
 *
 * It transpiles the REAL TypeScript sources — src/lib/glicko2.ts,
 * src/lib/themeRatings.ts and src/lib/ratingPipeline.ts — with the project's
 * installed `typescript` package and drives a real sequence of solves through
 * the exact `applyPuzzleResult` the store calls. No hand-rolled port.
 *
 * Asserts (per the task):
 *   (a) a clean first-try solve INCREASES the rating;
 *   (b) a wrong solve DECREASES it;
 *   (c) a HARD result DECREASES it (it is a loss, not a win);
 *   (d) a hint / viewed solution does NOT count as a clean win;
 *   (e) the change is Glicko-2-SHAPED: a first-time provisional player
 *       (RD 500) moves far more than an established one (RD 60) — a flat ±10
 *       would fail this; we assert the provisional move clears 20 points.
 * Plus: per-theme bookkeeping (same result to every carried theme), persistence
 * round-trip, and the ±100 session-window rule.
 *
 * Prints the actual numbers and exits non-zero on any failure.
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

// --- transpile the real TS to ESM in a temp dir ------------------------------
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rating-integration-"));

function transpile(file) {
  const src = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
    fileName: file,
  });
  return outputText;
}

const glickoJs = transpile(path.join(SRC, "glicko2.ts"));
const themeJs = transpile(path.join(SRC, "themeRatings.ts")).replace(
  /from\s+["']\.\/glicko2["']/g,
  'from "./glicko2.mjs"',
);
const pipelineJs = transpile(path.join(SRC, "ratingPipeline.ts"))
  .replace(/from\s+["']\.\/glicko2["']/g, 'from "./glicko2.mjs"')
  .replace(/from\s+["']\.\/themeRatings["']/g, 'from "./themeRatings.mjs"');

fs.writeFileSync(path.join(outDir, "glicko2.mjs"), glickoJs);
fs.writeFileSync(path.join(outDir, "themeRatings.mjs"), themeJs);
fs.writeFileSync(path.join(outDir, "ratingPipeline.mjs"), pipelineJs);

const g = await import(pathToFileURL(path.join(outDir, "glicko2.mjs")).href);
const tr = await import(pathToFileURL(path.join(outDir, "themeRatings.mjs")).href);
const rp = await import(pathToFileURL(path.join(outDir, "ratingPipeline.mjs")).href);

// --- tiny assertion harness --------------------------------------------------
let failures = 0;
let checks = 0;
const lines = [];

function ok(name, cond, detail = "") {
  checks += 1;
  if (cond) {
    lines.push(`  \u001b[32mPASS\u001b[0m ${name}${detail ? "  " + detail : ""}`);
  } else {
    failures += 1;
    lines.push(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? "  " + detail : ""}`);
  }
}
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const f3 = (n) => (Math.round(n * 1000) / 1000).toFixed(3);

// ---------------------------------------------------------------------------
// Scenario: a puzzle the store would hand us (rating 1500, two themes).
// ---------------------------------------------------------------------------
const PUZZLE = { rating: 1500, themes: ["fork", "pin"] };

function solve(state, attempt) {
  return rp.applyPuzzleResult(state, {
    puzzleRating: PUZZLE.rating,
    themes: PUZZLE.themes,
    ...attempt,
  });
}

lines.push("----------------------------------------------------------------");
lines.push("[1] (a) clean first-try solve INCREASES a fresh player's rating");
lines.push("----------------------------------------------------------------");
{
  const fresh = rp.initialRatingState();
  lines.push(
    `  initial: rating=${fresh.overall.rating} RD=${fresh.overall.deviation} sigma=${fresh.overall.volatility}`,
  );
  const r = solve(fresh, { result: "correct", hintUsed: false, solutionViewed: false });
  lines.push(
    `  clean solve vs ${PUZZLE.rating}: rating ${f2(r.before.rating)} -> ${f2(r.after.rating)} (delta ${f2(r.delta)}), RD ${f2(r.before.deviation)} -> ${f2(r.after.deviation)}`,
  );
  ok("(a) clean solve increases rating", r.after.rating > r.before.rating, `delta=${f2(r.delta)}`);
  ok("(a) isWin === true", r.isWin === true);
  ok("(a) RD shrinks on a rated game", r.after.deviation < r.before.deviation);
}

lines.push("");
lines.push("----------------------------------------------------------------");
lines.push("[2] (b) wrong solve DECREASES the rating");
lines.push("----------------------------------------------------------------");
{
  const r = solve(rp.initialRatingState(), { result: "incorrect", hintUsed: false, solutionViewed: false });
  lines.push(`  wrong solve: ${f2(r.before.rating)} -> ${f2(r.after.rating)} (delta ${f2(r.delta)})`);
  ok("(b) wrong solve decreases rating", r.after.rating < r.before.rating, `delta=${f2(r.delta)}`);
  ok("(b) wrong solve is not a win", r.isWin === false);
}

lines.push("");
lines.push("----------------------------------------------------------------");
lines.push("[3] (c) HARD result DECREASES the rating (a loss, not a win)");
lines.push("----------------------------------------------------------------");
{
  const r = solve(rp.initialRatingState(), { result: "hard", hintUsed: false, solutionViewed: false });
  lines.push(`  HARD press: ${f2(r.before.rating)} -> ${f2(r.after.rating)} (delta ${f2(r.delta)})`);
  ok("(c) HARD decreases rating", r.after.rating < r.before.rating, `delta=${f2(r.delta)}`);
  ok("(c) HARD is NOT a win", r.isWin === false);
}

lines.push("");
lines.push("----------------------------------------------------------------");
lines.push("[4] (d) hint / viewed solution do NOT count as a clean win");
lines.push("----------------------------------------------------------------");
{
  const hinted = solve(rp.initialRatingState(), { result: "correct", hintUsed: true, solutionViewed: false });
  lines.push(`  treated 'correct' WITH hint: ${f2(hinted.before.rating)} -> ${f2(hinted.after.rating)} (delta ${f2(hinted.delta)})`);
  ok("(d) hint-assisted solve is not a win", hinted.isWin === false);
  ok("(d) hint-assisted solve does not increase rating", hinted.after.rating <= hinted.before.rating, `delta=${f2(hinted.delta)}`);

  const shown = solve(rp.initialRatingState(), { result: "solution", hintUsed: false, solutionViewed: true });
  lines.push(`  viewed solution: ${f2(shown.before.rating)} -> ${f2(shown.after.rating)} (delta ${f2(shown.delta)})`);
  ok("(d) viewed solution is not a win", shown.isWin === false);
  ok("(d) viewed solution decreases rating", shown.after.rating < shown.before.rating, `delta=${f2(shown.delta)}`);

  ok("(d) isCleanWin helper agrees", rp.isCleanWin("correct", false, false) === true && rp.isCleanWin("correct", true, false) === false && rp.isCleanWin("correct", false, true) === false && rp.isCleanWin("hard", false, false) === false);
}

lines.push("");
lines.push("----------------------------------------------------------------");
lines.push("[5] (e) Glicko-2 SHAPE: provisional moves far more than established");
lines.push("     (a flat ±10 could not produce this)");
lines.push("----------------------------------------------------------------");
{
  const provisional = solve(rp.initialRatingState(), { result: "correct", hintUsed: false, solutionViewed: false });
  const establishedState = { overall: { rating: 1500, deviation: 60, volatility: 0.06 }, themes: {} };
  const established = solve(establishedState, { result: "correct", hintUsed: false, solutionViewed: false });
  const provDelta = Math.abs(provisional.delta);
  const estDelta = Math.abs(established.delta);
  lines.push(`  provisional (RD 500) clean win delta: ${f2(provDelta)} points`);
  lines.push(`  established (RD 60)  clean win delta: ${f2(estDelta)} points`);
  ok("(e) provisional first-solve change > 20 points", provDelta > 20, `${f2(provDelta)}`);
  ok("(e) provisional moves much more than established (>5x)", provDelta > estDelta * 5, `prov=${f2(provDelta)} est=${f2(estDelta)}`);

  // Same picture on a loss: the provisional player drops far more.
  const provLoss = solve(rp.initialRatingState(), { result: "incorrect", hintUsed: false, solutionViewed: false });
  const estLoss = solve(establishedState, { result: "incorrect", hintUsed: false, solutionViewed: false });
  lines.push(`  provisional loss delta: ${f2(provLoss.delta)}  |  established loss delta: ${f2(estLoss.delta)}`);
  ok("(e) provisional loss magnitude > established loss magnitude", Math.abs(provLoss.delta) > Math.abs(estLoss.delta));
}

lines.push("");
lines.push("----------------------------------------------------------------");
lines.push("[6] per-theme ratings: SAME result applied to EVERY carried theme");
lines.push("----------------------------------------------------------------");
{
  const r = solve(rp.initialRatingState(), { result: "correct", hintUsed: false, solutionViewed: false });
  const fork = r.state.themes["fork"];
  const pin = r.state.themes["pin"];
  const endgame = tr.getTheme(r.state.themes, "endgame");
  lines.push(`  fork: rating=${f2(fork.rating)} played=${fork.played} correct=${fork.correct}`);
  lines.push(`  pin : rating=${f2(pin.rating)} played=${pin.played} correct=${pin.correct}`);
  lines.push(`  endgame (untouched): rating=${f2(endgame.rating)} RD=${f2(endgame.deviation)}`);
  ok("fork updated", !!fork && fork.played === 1 && fork.correct === 1 && fork.rating > 1500);
  ok("pin updated identically", !!pin && pin.played === 1 && f2(pin.rating) === f2(fork.rating));
  ok("unrelated theme left at initial", endgame.rating === 1500 && endgame.deviation === 500);
}

lines.push("");
lines.push("----------------------------------------------------------------");
lines.push("[7] persistence round-trip + ±100 session window");
lines.push("----------------------------------------------------------------");
{
  let state = rp.initialRatingState();
  state = solve(state, { result: "correct", hintUsed: false, solutionViewed: false }).state;
  state = solve(state, { result: "incorrect", hintUsed: false, solutionViewed: false }).state;
  const restored = rp.deserializeRatingState(rp.serializeRatingState(state));
  lines.push(`  overall before=${f2(state.overall.rating)} after round-trip=${f2(restored.overall.rating)}`);
  lines.push(`  fork before=${f2(state.themes.fork.rating)} after round-trip=${f2(restored.themes.fork.rating)}`);
  ok("overall survives serialize/deserialize", Math.abs(restored.overall.rating - state.overall.rating) < 0.01 && Math.abs(restored.overall.deviation - state.overall.deviation) < 0.01);
  ok("theme store survives serialize/deserialize", !!restored.themes.fork && Math.abs(restored.themes.fork.rating - state.themes.fork.rating) < 0.01 && restored.themes.fork.played === state.themes.fork.played);

  ok("window: |1500-1500| = 0 -> no flush", rp.shouldFlushSession(1500, 1500) === false);
  ok("window: |1600-1500| = 100 -> no flush (must exceed 100)", rp.shouldFlushSession(1600, 1500) === false);
  ok("window: |1601-1500| = 101 -> flush", rp.shouldFlushSession(1601, 1500) === true);
  ok("window: |1399-1500| = 101 -> flush", rp.shouldFlushSession(1399, 1500) === true);
  ok("window: SESSION_WINDOW constant is 100", rp.SESSION_WINDOW === 100);
}

lines.push("");
lines.push(`  puzzle opponent deviation assumption: PUZZLE_DEVIATION = ${rp.PUZZLE_DEVIATION}`);

console.log(lines.join("\n"));
console.log("\n------------------------------------------------------------");
if (failures === 0) {
  console.log(`\u001b[32mPASS\u001b[0m  all ${checks} checks passed`);
} else {
  console.log(`\u001b[31mFAIL\u001b[0m  ${failures}/${checks} checks FAILED`);
}
console.log("------------------------------------------------------------");
process.exit(failures === 0 ? 0 : 1);
