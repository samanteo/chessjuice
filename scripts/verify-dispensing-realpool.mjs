/**
 * Verify the Lichess-faithful dispenser against the REAL 6.19M catalogue.
 * Confirms the served puzzle's rating lands in the flex band, and that the
 * recently-served exclusion works on real data.
 *
 * NOTE: this used to read public/puzzles.csv. That 53 MB file is gone — the
 * catalogue is served from SQLite — so the sample now comes from /api/puzzles.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "disp-real-"));
const out = path.join(tmp, "dispensing.mjs");
fs.writeFileSync(out, ts.transpileModule(
  fs.readFileSync(path.join(ROOT, "src/lib/dispensing.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText);
const { selectPuzzle, flexFor, DIFFICULTY_DELTA } = await import(pathToFileURL(out).href);

// ---- build a real pool from the server (fork puzzles, random rows) ----
const API = process.env.API_BASE ?? "http://localhost:3000";
const byId = new Map();
for (let i = 0; i < 8; i++) {
  const res = await fetch(`${API}/api/puzzles?themes=fork&limit=100`);
  if (!res.ok) throw new Error(`pool fetch failed: ${res.status}`);
  for (const r of await res.json()) {
    byId.set(r.id, { id: r.id, rating: r.rating, popularity: r.popularity ?? 0, themes: r.themes });
  }
}
const pool = Array.from(byId.values());
console.log(`fork puzzles sampled from the live catalogue: ${pool.length.toLocaleString()}`);
if (pool.length === 0) { console.log("no pool — is the dev server up?"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

// ---- 1. rating targeting on real data ----
for (const userRating of [900, 1200, 1500, 1800, 2100]) {
  const inside = [];
  for (let i = 0; i < 300; i++) {
    const { puzzle, trace } = selectPuzzle(pool, { userRating, difficultyId: "normal", random: Math.random });
    inside.push(Math.abs(puzzle.rating - trace.target) <= trace.flex + 1e-9);
  }
  const allIn = inside.every(Boolean);
  const flex = flexFor(userRating, 0);
  console.log(`  userRating ${userRating} -> band ±${flex} : ${inside.filter(Boolean).length}/300 inside`);
  ok(allIn, `every served puzzle inside the band at userRating=${userRating}`);
}

// ---- 2. difficulty shifts the band on real data ----
const easy = selectPuzzle(pool, { userRating: 1500, difficultyId: "easier", random: Math.random });
const hard = selectPuzzle(pool, { userRating: 1500, difficultyId: "harder", random: Math.random });
console.log(`  easier target ${easy.trace.target} -> served rating ${easy.puzzle.rating}`);
console.log(`  harder target ${hard.trace.target} -> served rating ${hard.puzzle.rating}`);
ok(easy.trace.target === 1200 && hard.trace.target === 1800, "deltas are exactly ±300 (Lichess)");
ok(easy.puzzle.rating < hard.puzzle.rating, "easier actually serves an easier puzzle than harder");

// ---- 3. exclusion over a long run on real data ----
// The sample spans a wide rating range, so the in-band population at 1500 is the
// real ceiling. Assert against THAT, not an absolute number: the guarantee is
// "no immediate repeat while unused in-band puzzles remain".
const inBand = pool.filter((p) => Math.abs(p.rating - 1500) <= flexFor(1500, 0)).length;
const seen = new Set();
let repeats = 0;
let repeatsWhileFresh = 0;
for (let i = 0; i < 500; i++) {
  const { puzzle } = selectPuzzle(pool, { userRating: 1500, difficultyId: "normal", exclude: seen, random: Math.random });
  if (seen.has(puzzle.id)) {
    repeats++;
    if (seen.size < inBand) repeatsWhileFresh++;
  }
  seen.add(puzzle.id);
}
console.log(`  in-band at 1500: ${inBand}; 500 picks -> ${seen.size} distinct, ${repeats} repeats (${repeatsWhileFresh} while fresh remained)`);
ok(repeatsWhileFresh === 0, "no immediate repeat while unused in-band puzzles remain");
ok(seen.size >= Math.min(inBand, 500) * 0.9, `explores the available band (${seen.size}/${inBand})`);

// ---- 4. band width vs the pool's real rating spread ----
const bandSize = pool.filter(p => Math.abs(p.rating - 1500) <= 100).length;
console.log(`  fork puzzles within ±100 of 1500: ${bandSize}`);
ok(bandSize > 0, "the band is populated at a typical rating");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
