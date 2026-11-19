/**
 * Runnable proof for the Glicko-2 engine.
 *
 *   node scripts/verify-glicko.mjs
 *
 * It transpiles the REAL TypeScript sources (src/lib/glicko2.ts,
 * src/lib/themeRatings.ts) with the project's installed `typescript` package and
 * imports the result, so the assertions exercise exactly the shipped code — no
 * hand-rolled JS port that could drift.
 *
 * Exits non-zero on any failure and prints a PASS/FAIL summary with the numbers.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript"); // CJS default interop

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src", "lib");

// --- transpile the real TS to ESM in a temp dir ------------------------------
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "glicko-verify-"));

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
// rewrite the relative import specifier to the emitted file name
const themeJs = transpile(path.join(SRC, "themeRatings.ts")).replace(
  /from\s+["']\.\/glicko2["']/g,
  'from "./glicko2.mjs"',
);

fs.writeFileSync(path.join(outDir, "glicko2.mjs"), glickoJs);
fs.writeFileSync(path.join(outDir, "themeRatings.mjs"), themeJs);

const g = await import(pathToFileURL(path.join(outDir, "glicko2.mjs")).href);
const tr = await import(pathToFileURL(path.join(outDir, "themeRatings.mjs")).href);

// --- tiny assertion harness --------------------------------------------------
let failures = 0;
let checks = 0;
const results = [];

function ok(name, cond, detail = "") {
  checks += 1;
  if (cond) {
    results.push(`  \u001b[32mPASS\u001b[0m ${name}${detail ? "  " + detail : ""}`);
  } else {
    failures += 1;
    results.push(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? "  " + detail : ""}`);
  }
}
function close(name, actual, expected, eps) {
  const diff = Math.abs(actual - expected);
  ok(
    name,
    diff <= eps,
    `computed=${fmt(actual)} expected=${fmt(expected)} |diff|=${fmt(diff)} eps=${eps}`,
  );
}
const fmt = (n) => (typeof n === "number" ? Math.abs(n) < 1 ? n.toFixed(6) : n.toFixed(4) : String(n));

console.log("Glicko-2 verification \u2014 transpiled real sources from src/lib/\n");

// ============================================================================
// 1. Glickman's published worked example (the gold-standard correctness check)
// ============================================================================
console.log("[1] Glickman's published worked example");
console.log("    player r=1500 RD=200 sigma=0.06 tau=0.5 (paper's example value)");
console.log("    results: win vs (1400,RD30), loss vs (1550,RD100), loss vs (1700,RD300)");
{
  const player = { rating: 1500, deviation: 200, volatility: 0.06 };
  const r = (rating, deviation) => ({ rating, deviation, volatility: 0.06 });
  const updated = g.updateRating(
    player,
    [
      { opponent: r(1400, 30), score: 1 },
      { opponent: r(1550, 100), score: 0 },
      { opponent: r(1700, 300), score: 0 },
    ],
    { tau: 0.5 },
  );
  console.log(
    `    computed:  r'=${fmt(updated.rating)}  RD'=${fmt(updated.deviation)}  sigma'=${fmt(
      updated.volatility,
    )}`,
  );
  console.log("    published: r'=1464.06     RD'=151.52     sigma'=0.05999\n");
  close("worked example: new rating", updated.rating, 1464.06, 0.05);
  close("worked example: new RD", updated.deviation, 151.52, 0.05);
  close("worked example: new volatility", updated.volatility, 0.05999, 0.0002);
}
console.log(results.splice(0).join("\n"));

// ============================================================================
// 2. Sanity properties
// ============================================================================
console.log("\n[2] Sanity properties");
{
  // (a) RD decreases as more results come in
  let p = { rating: 1500, deviation: 500, volatility: 0.09 };
  const rd1 = g.updateRating(p, [{ opponent: 1500, score: 1 }]).deviation;
  let q = { rating: 1500, deviation: 500, volatility: 0.09 };
  for (let i = 0; i < 10; i++) q = g.updateRating(q, [{ opponent: 1500, score: 1 }]);
  console.log(`    RD after 1 game = ${fmt(rd1)}, after 10 games = ${fmt(q.deviation)}`);
  ok("RD decreases with more results", q.deviation < rd1, `(${fmt(q.deviation)} < ${fmt(rd1)})`);

  // (b) upset win gains more than an expected win
  const base = { rating: 1500, deviation: 60, volatility: 0.09 };
  const beatHigh = g.rateOne(base, 1900, 1).rating - base.rating;
  const beatLow = g.rateOne(base, 1100, 1).rating - base.rating;
  console.log(`    win vs 1900 gains ${fmt(beatHigh)}; win vs 1100 gains ${fmt(beatLow)}`);
  ok("upset win gains more than expected win", beatHigh > beatLow, `(${fmt(beatHigh)} > ${fmt(beatLow)})`);

  // (c) losing to a much lower-rated opponent costs more
  const lostToLow = g.rateOne(base, 1200, 0).rating - base.rating;
  const lostToHigh = g.rateOne(base, 1800, 0).rating - base.rating;
  console.log(`    loss vs 1200 costs ${fmt(lostToLow)}; loss vs 1800 costs ${fmt(lostToHigh)}`);
  ok("loss to weaker opponent costs more", lostToLow < lostToHigh, `(${fmt(lostToLow)} < ${fmt(lostToHigh)})`);

  // (d) a brand-new player moves much further than a settled one
  const newbie = g.rateOne({ rating: 1500, deviation: 500, volatility: 0.09 }, 1500, 1);
  const settled = g.rateOne({ rating: 1500, deviation: 60, volatility: 0.09 }, 1500, 1);
  const newbieDelta = Math.abs(newbie.rating - 1500);
  const settledDelta = Math.abs(settled.rating - 1500);
  console.log(`    new player (RD 500) moves ${fmt(newbieDelta)}; settled (RD 60) moves ${fmt(settledDelta)}`);
  ok("new player moves further than settled", newbieDelta > settledDelta, `(${fmt(newbieDelta)} > ${fmt(settledDelta)})`);
}
console.log(results.splice(0).join("\n"));

// ============================================================================
// 3. Per-theme store
// ============================================================================
console.log("\n[3] Per-theme store");
{
  let store = {};
  store = tr.applyAttempt(store, { puzzleRating: 1500, themes: ["fork", "pin"], solved: true });

  const fork = tr.getTheme(store, "fork");
  const pin = tr.getTheme(store, "pin");
  const skewer = tr.getTheme(store, "skewer");
  const init = g.initialGlicko();

  console.log(`    fork   -> rating=${fmt(fork.rating)} played=${store.fork.played} correct=${store.fork.correct}`);
  console.log(`    pin    -> rating=${fmt(pin.rating)} played=${store.pin.played} correct=${store.pin.correct}`);
  console.log(`    skewer -> rating=${fmt(skewer.rating)} dev=${fmt(skewer.deviation)} (untouched)`);

  ok("fork updated (rating != initial)", fork.rating !== init.rating);
  ok("pin updated (rating != initial)", pin.rating !== init.rating);
  ok("fork and pin move identically", Math.abs(fork.rating - pin.rating) < 1e-9);
  ok("fork played=1 correct=1", store.fork.played === 1 && store.fork.correct === 1);
  ok(
    "untouched theme stays at initial",
    skewer.rating === init.rating && skewer.deviation === init.deviation && skewer.volatility === init.volatility,
  );

  // round-trip serialisation (compact format rounds to 2dp, so compare with tolerance)
  const round = tr.deserializeThemeStore(tr.serializeThemeStore(store));
  ok(
    "theme store serialise/deserialise round-trips",
    Math.abs(round.fork.rating - store.fork.rating) < 0.01 &&
      round.fork.played === store.fork.played &&
      Math.abs(round.pin.rating - store.pin.rating) < 0.01,
    `fork ${fmt(round.fork.rating)} vs ${fmt(store.fork.rating)}`,
  );

  // overall derived rating equals the played-weighted blend (one theme here)
  const ov = tr.overall(store);
  console.log(`    overall  -> rating=${fmt(ov.rating)}`);
  ok(
    "overall blends played themes",
    Math.abs(ov.rating - fork.rating) < 1e-6,
    `(${fmt(ov.rating)} ~ ${fmt(fork.rating)})`,
  );
  ok("empty store overall = initial Glicko", tr.overall({}).rating === init.rating);
}
console.log(results.splice(0).join("\n"));

// ============================================================================
// 4. Cross-check against scalachess's own reference unit tests
//    (test-kit/src/test/scala/rating/glicko/GlickoCalculatorTest.scala,
//     which itself validates against glicko.net/glicko/glicko2.pdf).
//    These use the Lichess default tau=0.75 and skipDeviationIncrease=true.
// ============================================================================
console.log("\n[4] Cross-check vs scalachess reference tests (tau=0.75, elapsed=0)");
{
  const opts = { elapsedRatingPeriods: 0 };
  const r = (rating, deviation, volatility) => ({ rating, deviation, volatility });

  // Group A: 1500/350/0.06 vs 1500/350/0.06
  {
    const a = r(1500, 350, 0.06);
    const w = g.rateOne(a, r(1500, 350, 0.06), 1, opts);
    const b = g.rateOne(a, r(1500, 350, 0.06), 0, opts);
    close("scalachess A: white wins -> rating", w.rating, 1662.21, 0.005);
    close("scalachess A: black loses -> rating", b.rating, 1337.79, 0.005);
    close("scalachess A: white new RD", w.deviation, 290.2305, 0.00005);
    close("scalachess A: white new volatility", w.volatility, 0.0599993, 0.000002);
  }
  // Group B: 1400/79/0.06 vs 1550/110/0.065
  {
    const white = r(1400, 79, 0.06);
    const black = r(1550, 110, 0.065);
    const w = g.rateOne(white, black, 1, opts);
    const b = g.rateOne(black, white, 0, opts);
    close("scalachess B: white wins -> rating", w.rating, 1422.63, 0.005);
    close("scalachess B: black loses -> rating", b.rating, 1506.32, 0.005);
    close("scalachess B: white new RD", w.deviation, 77.4956, 0.00005);
    close("scalachess B: black new RD", b.deviation, 105.8706, 0.00005);
  }
  // Group C: 1200/60/0.053 vs 1850/200/0.062
  {
    const white = r(1200, 60, 0.053);
    const black = r(1850, 200, 0.062);
    const w = g.rateOne(white, black, 1, opts);
    const b = g.rateOne(black, white, 0, opts);
    close("scalachess C: white wins -> rating", w.rating, 1216.73, 0.005);
    close("scalachess C: black loses -> rating", b.rating, 1635.99, 0.005);
    close("scalachess C: white new RD", w.deviation, 59.9006, 0.00005);
    close("scalachess C: black new RD", b.deviation, 196.9873, 0.00005);
    close("scalachess C: white new volatility", w.volatility, 0.053013, 0.000001);
    close("scalachess C: black new volatility", b.volatility, 0.062028, 0.000001);
  }
}
console.log(results.splice(0).join("\n"));

// ============================================================================
// Summary
// ============================================================================
const line = "-".repeat(60);
console.log("\n" + line);
if (failures === 0) {
  console.log(`\u001b[32mPASS\u001b[0m  all ${checks} checks passed`);
  console.log(line);
  process.exit(0);
} else {
  console.log(`\u001b[31mFAIL\u001b[0m  ${failures} of ${checks} checks failed`);
  console.log(line);
  process.exit(1);
}
