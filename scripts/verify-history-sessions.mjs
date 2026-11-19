/**
 * Assertions for the Lichess session-grouping port.
 * Imports the REAL src/lib/historySessions.ts (transpiled from source).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sess-"));
const out = path.join(tmp, "historySessions.mjs");
fs.writeFileSync(out, ts.transpileModule(
  fs.readFileSync(path.join(ROOT, "src/lib/historySessions.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText);

const M = await import(pathToFileURL(out).href);
const { groupIntoSessions, resolveAngle, angleLabel, sessionsNewestFirst, SESSION_GAP_MS, SESSIONS_PER_PAGE } = M;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };

const T0 = new Date("2026-11-19T10:00:00Z").getTime();
const MIN = 60_000;
const mk = (id, minutesFromT0, angle, result = "correct") => ({
  puzzleId: id, at: new Date(T0 + minutesFromT0 * MIN), angle, result,
  rating: 1500, themes: [], openings: [],
});

console.log("== A. lila constants ==");
ok(SESSION_GAP_MS === 3_600_000, "gap is exactly 1 hour (minusHours(1))");
ok(SESSIONS_PER_PAGE === 100, "100 sessions per page (maxPerPage)");

console.log("\n== B. same angle within 1h folds into ONE session ==");
let s = groupIntoSessions([mk("a", 0, "sicilian"), mk("b", 10, "sicilian"), mk("c", 25, "sicilian")]);
console.log(`   sessions=${s.length} rounds=${s[0]?.rounds.length}`);
ok(s.length === 1, "3 rounds, same angle, 25min apart -> 1 session");
ok(s[0].rounds.map(r => r.puzzleId).join(",") === "a,b,c", "rounds kept oldest-first");

console.log("\n== C. a different angle starts a NEW session ==");
s = groupIntoSessions([mk("a", 0, "sicilian"), mk("b", 5, "fork"), mk("c", 10, "sicilian")]);
console.log(`   angles=${s.map(x => x.angle).join(" -> ")}`);
ok(s.length === 3, "angle change always breaks the session");

console.log("\n== D. the 1-hour boundary ==");
s = groupIntoSessions([mk("a", 0, "mix"), mk("b", 59, "mix")]);
ok(s.length === 1, "gap 59min -> SAME session");
s = groupIntoSessions([mk("a", 0, "mix"), mk("b", 60, "mix")]);
console.log(`   gap exactly 60min -> sessions=${s.length}`);
ok(s.length === 2, "gap exactly 60min -> NEW session (strict isAfter)");
s = groupIntoSessions([mk("a", 0, "mix"), mk("b", 61, "mix")]);
ok(s.length === 2, "gap 61min -> NEW session");

console.log("\n== E. mixed angles interleaved (realistic) ==");
s = groupIntoSessions([
  mk("a", 0, "mix"), mk("b", 5, "mix"),          // session 1
  mk("c", 20, "sicilianDefense"),                 // session 2
  mk("d", 25, "sicilianDefense"), mk("e", 40, "sicilianDefense"), // session 2
  mk("f", 300, "mix"),                            // session 3 (gap too big anyway)
]);
console.log(`   ${s.map(x => `${x.angle}(${x.rounds.length})`).join("  ")}`);
ok(s.length === 3, "5 rounds -> 3 sessions");
ok(s[0].rounds.length === 2 && s[1].rounds.length === 3, "round counts split correctly");
ok(s[1].angle === "sicilianDefense", "session angle comes from its FIRST round");

console.log("\n== F. input order does not matter ==");
const asc = groupIntoSessions([mk("a", 0, "mix"), mk("b", 5, "mix"), mk("c", 30, "fork")]);
const desc = groupIntoSessions([mk("c", 30, "fork"), mk("b", 5, "mix"), mk("a", 0, "mix")]);
ok(asc.length === desc.length, "same session count regardless of input order");
ok(JSON.stringify(asc.map(x => x.rounds.map(r => r.puzzleId))) ===
   JSON.stringify(desc.map(x => x.rounds.map(r => r.puzzleId))), "identical grouping");

console.log("\n== G. session time bounds ==");
s = groupIntoSessions([mk("a", 0, "mix"), mk("b", 30, "mix")]);
ok(s[0].startedAt.getTime() === T0, "startedAt = oldest round");
ok(s[0].endedAt.getTime() === T0 + 30 * MIN, "endedAt = newest round");

console.log("\n== H. angle resolution (opening wins, else mix) ==");
ok(resolveAngle({ openings: ["sicilianDefense"] }) === "sicilianDefense", "opening tag -> opening angle");
ok(resolveAngle({ openings: ["sicilianDefense"], themes: ["fork"] }) === "sicilianDefense", "opening beats theme");
ok(resolveAngle({ openings: [] }) === "mix", "no opening -> mix");
ok(resolveAngle({}) === "mix", "nothing -> mix");
ok(resolveAngle({ angle: "fork", openings: ["sicilianDefense"] }) === "fork", "explicit angle wins");

console.log("\n== I. labels ==");
ok(angleLabel("mix") === "Mixed", "mix -> Mixed");
ok(angleLabel("sicilianDefense") === "Sicilian Defense", "camelCase -> Title Case");
ok(angleLabel("sicilianDefenseDragonVariation") === "Sicilian Defense Dragon Variation", "deep variation");

console.log("\n== J. newest-first ordering for display ==");
s = groupIntoSessions([mk("a", 0, "mix"), mk("b", 120, "fork"), mk("c", 240, "pin")]);
const disp = sessionsNewestFirst(s);
console.log(`   ${disp.map(x => x.angle).join(" -> ")}`);
ok(disp[0].angle === "pin", "newest session first");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
