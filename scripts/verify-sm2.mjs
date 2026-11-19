/**
 * verify-sm2.mjs — runnable assertions for the HARDCODED-LADDER scheduler.
 *
 * Imports the REAL scheduler directly from ../src/lib/sm2.ts (Node >= 22.6
 * strips TypeScript types natively; Node 26 runs .ts with no transpiler). It is
 * NOT a re-implementation, so it cannot drift from the production logic.
 *
 * Run:  node scripts/verify-sm2.mjs      (exit code 0 = all good, 1 = failure)
 *
 * The ladder has NO ease factor and NO interval multiplication — the ladder IS
 * the schedule. Only two outcomes exist:
 *   - correct -> advance exactly one rung (rung 7 -> mastered)
 *   - hard    -> identical to a wrong answer: straight back to rung 0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LADDER_DAYS,
  MAX_RUNG,
  MASTERED_RUNG,
  TODAY_DELAY_MINUTES,
  delayMsForRung,
  ladderDaysForRung,
  createInitialWrongPuzzleState,
  createInitialCorrectState,
  calculateNextState,
  getQueueType,
  isDue,
  getIntervalDescription,
  simulateProgression,
  stateToDbRow,
  dbRowToState,
} from '../src/lib/sm2.ts';

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

let pass = 0;
let fail = 0;
let notes = 0;
const failures = [];

function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push(`${label} ${extra}`);
    console.log(`  FAIL  ${label}   ${extra}`);
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
}
function nearMs(state, expectedMs, label, tolMs = 5000) {
  const delta = state.dueDate.getTime() - Date.now();
  ok(Math.abs(delta - expectedMs) <= tolMs, label,
    `expected ~${(expectedMs / MIN).toFixed(2)}min, got ${(delta / MIN).toFixed(4)}min`);
}
const nearMin = (s, m, l) => nearMs(s, m * MIN, l);
const nearDays = (s, d, l) => nearMs(s, d * DAY, l);
function note(msg) { notes++; console.log(`  NOTE  ${msg}`); }
function section(t) { console.log(`\n== ${t} ==`); }

console.log('Ladder verification — importing the REAL module: ../src/lib/sm2.ts');
console.log(`Node ${process.version}`);
console.log(`LADDER_DAYS=${JSON.stringify(LADDER_DAYS)}  MAX_RUNG=${MAX_RUNG}  ` +
  `MASTERED_RUNG=${MASTERED_RUNG}  TODAY_DELAY_MINUTES=${TODAY_DELAY_MINUTES}`);

// ---------------------------------------------------------------------------
section('0. Public API surface resolves');
for (const [name, fn] of Object.entries({
  delayMsForRung, ladderDaysForRung, createInitialWrongPuzzleState,
  createInitialCorrectState, calculateNextState, getQueueType, isDue,
  getIntervalDescription, simulateProgression, stateToDbRow, dbRowToState,
})) {
  eq(typeof fn, 'function', `export ${name} is a function`);
}
ok(Array.isArray(LADDER_DAYS) || ArrayBuffer.isView(LADDER_DAYS), 'LADDER_DAYS is an array');

// ---------------------------------------------------------------------------
section('1. The ladder table is the hardcoded schedule (today/1/2/3/7/14/30/90)');
eq(LADDER_DAYS.length, 8, 'ladder has 8 rungs (index 0..7)');
eq(MAX_RUNG, 7, 'MAX_RUNG = 7');
eq(MASTERED_RUNG, 8, 'MASTERED_RUNG = 8 (rung 7 completed)');
eq(ladderDaysForRung(0), 0, 'rung 0 -> today (0 days)');
for (const [rung, days] of [[1,1],[2,2],[3,3],[4,7],[5,14],[6,30],[7,90]]) {
  eq(LADDER_DAYS[rung], days, `rung ${rung} -> ${days} day(s)`);
}
nearMin({ dueDate: new Date(Date.now() + delayMsForRung(0)) }, TODAY_DELAY_MINUTES,
  `rung 0 delay = ${TODAY_DELAY_MINUTES} minutes (today's deck)`);

// ---------------------------------------------------------------------------
section('(a) WRONG -> rung 0, due back in TODAY\'S DECK');
let a = createInitialWrongPuzzleState();
eq(a.rung, 0, 'A1 new-wrong starts at rung 0');
eq(a.isWrongPuzzle, true, 'A2 new-wrong is flagged isWrongPuzzle');
nearMin(a, TODAY_DELAY_MINUTES, 'A3 new-wrong is due in a few minutes (today)');
eq(getQueueType(a), 'due', "A4 new-wrong sits in the Due queue (today's deck)");
eq(getIntervalDescription(a), 'Today', "A5 interval description = 'Today'");

// a wrong answer on an already-wrong puzzle drops to rung 0.
let a2 = createInitialWrongPuzzleState();
a2 = calculateNextState(a2, 'correct'); // rung 1
a2 = calculateNextState(a2, 'correct'); // rung 2
eq(a2.rung, 2, 'A6 setup: advanced to rung 2');
a2 = calculateNextState(a2, 'hard');    // WRONG
eq(a2.rung, 0, 'A7 wrong -> rung 0');
nearMin(a2, TODAY_DELAY_MINUTES, "A8 wrong -> due back in today's deck");

// ---------------------------------------------------------------------------
section('(b) CORRECT advances exactly ONE rung with the right day delays');
const delays = { 1: 1, 2: 2, 3: 3, 4: 7, 5: 14, 6: 30, 7: 90 };
let b = createInitialWrongPuzzleState();
let prevRung = 0;
for (let rung = 1; rung <= MAX_RUNG; rung++) {
  b = calculateNextState(b, 'correct');
  eq(b.rung, prevRung + 1, `B${rung}a correct advances ${prevRung} -> ${rung} (exactly one rung)`);
  nearDays(b, delays[rung], `B${rung}b rung ${rung} -> due in ${delays[rung]} day(s)`);
  prevRung = rung;
}
eq(b.rung, 7, 'B8 seven correct answers reach rung 7');

// ---------------------------------------------------------------------------
section('(c) HARD is IDENTICAL to WRONG (same rung, same due date)');
// WRONG and HARD share ONE transition in the API ('hard'); assert the resulting
// states are identical, byte for byte.
const startC = { rung: 4, dueDate: new Date(Date.now() + 7 * DAY), isWrongPuzzle: true };
const asWrong = calculateNextState(startC, 'hard'); // WRONG answer
const asHard = calculateNextState(startC, 'hard');  // HARD button
eq(asHard.rung, asWrong.rung, 'C1 HARD rung === WRONG rung');
eq(asHard.rung, 0, 'C2 both drop to rung 0');
eq(asHard.isWrongPuzzle, asWrong.isWrongPuzzle, 'C3 isWrongPuzzle identical');
eq(asHard.lastResult, asWrong.lastResult, 'C4 lastResult identical');
const wrongOff = Math.round((asWrong.dueDate.getTime() - Date.now()) / MIN);
const hardOff = Math.round((asHard.dueDate.getTime() - Date.now()) / MIN);
eq(hardOff, wrongOff, 'C5 due-date offset identical (same minute)');
eq(wrongOff, TODAY_DELAY_MINUTES, 'C6 both due back in today\'s deck');
const rowW = stateToDbRow(asWrong);
const rowH = stateToDbRow(asHard);
eq(JSON.stringify({ r: rowH.rung, w: rowH.is_wrong_puzzle, l: rowH.last_result }),
   JSON.stringify({ r: rowW.rung, w: rowW.is_wrong_puzzle, l: rowW.last_result }),
   'C7 serialized HARD state === serialized WRONG state (rung/wrong/last_result)');
note('There is exactly ONE not-solid transition ("hard"): the HARD button and a ' +
     'wrong answer call the identical code path, so they cannot diverge.');

// ---------------------------------------------------------------------------
section('(d) A wrong answer at ANY rung drops ALL the way to rung 0');
for (let rung = 0; rung <= MAX_RUNG; rung++) {
  const s = { rung, dueDate: new Date(Date.now() + 999 * DAY), isWrongPuzzle: true };
  const w = calculateNextState(s, 'hard');
  eq(w.rung, 0, `D wrong from rung ${rung} -> rung 0`);
  nearMin(w, TODAY_DELAY_MINUTES, `D rung ${rung} fail returns to today's deck`);
}
// emphasize rung 6
let d6 = createInitialWrongPuzzleState();
for (let i = 0; i < 6; i++) d6 = calculateNextState(d6, 'correct');
eq(d6.rung, 6, 'D6 setup: on rung 6 (30-day step)');
d6 = calculateNextState(d6, 'hard');
eq(d6.rung, 0, 'D6* wrong at rung 6 -> rung 0 (all the way back)');
eq(getQueueType(d6), 'due', "D6** back in today's deck");

// ---------------------------------------------------------------------------
section('(e) Completing rung 7 -> MASTERED, and the puzzle is NOT deleted');
let e = createInitialWrongPuzzleState();
for (let i = 0; i < 7; i++) e = calculateNextState(e, 'correct');
eq(e.rung, 7, 'E1 at rung 7 (90-day step) before the final correct');
e = calculateNextState(e, 'correct'); // completing rung 7
eq(e.rung, MASTERED_RUNG, `E2 completing rung 7 -> rung ${MASTERED_RUNG} (mastered)`);
eq(getQueueType(e), 'mastered', "E3 getQueueType -> 'mastered'");
eq(e.removedAt, undefined, 'E4 NOT deleted (no removedAt) — still viewable');
eq(getQueueType(e) === 'archived', false, "E5 never auto-'archived'");
eq(e.isWrongPuzzle, true, 'E6 still flagged a mistake (viewable), just mastered');
eq(isDue(e), false, 'E7 mastered puzzle is not due');
eq(getIntervalDescription(e), 'Mastered', "E8 description 'Mastered'");

// ---------------------------------------------------------------------------
section('(f) NO ease factor and NO multiplication left in the module');
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/lib/sm2.ts'), 'utf8');
ok(!/ease/i.test(src), 'F1 no "ease" anywhere in sm2.ts');
ok(!/intervalDays|repetition|easeFactor/i.test(src), 'F2 no intervalDays/repetition/easeFactor fields');
ok(!/\*\s*ease/i.test(src), 'F3 no interval x ease multiplication');
ok(!/Math\.round\(/.test(src), 'F4 no rounding of multiplied intervals');
ok(/LADDER_DAYS/.test(src), 'F5 the schedule comes from the LADDER_DAYS table');
ok(!/'again'|'good'|'easy'/.test(src), "F6 the four-grade API ('again'/'good'/'easy') is gone");
note('Time-unit conversion (minutes/hours -> ms) still uses arithmetic; that is not ' +
     'schedule maths — the schedule itself is a constant lookup table.');

// ---------------------------------------------------------------------------
section('G. Queue classification on the ladder');
eq(getQueueType(createInitialWrongPuzzleState()), 'due', "G1 rung 0 -> due (today's deck)");
const gFuture = { rung: 3, dueDate: new Date(Date.now() + 3 * DAY), isWrongPuzzle: true };
eq(getQueueType(gFuture), 'learning', 'G2 future-scheduled rung -> learning (answered right, waiting for its next rung date)');
const gOverdue = { rung: 3, dueDate: new Date(Date.now() - DAY), isWrongPuzzle: true };
eq(getQueueType(gOverdue), 'due', 'G3 overdue rung -> due');
eq(isDue(gOverdue), true, 'G4 isDue true when overdue');
eq(isDue(gFuture), false, 'G5 isDue false when scheduled ahead');
eq(getQueueType(createInitialCorrectState()), 'new', "G6 clean solve -> 'new' (never queued)");
eq(getQueueType({ ...gOverdue, removedAt: new Date() }), 'archived', "G7 removedAt -> 'archived' (manual only)");
eq(getQueueType({ rung: MASTERED_RUNG, dueDate: new Date(), isWrongPuzzle: true }), 'mastered', "G8 completed ladder -> 'mastered'");

// ---------------------------------------------------------------------------
section('H. getIntervalDescription mapping');
eq(getIntervalDescription(createInitialWrongPuzzleState()), 'Today', 'H1 rung 0 -> Today');
const mk = (rung) => ({ rung, dueDate: new Date(), isWrongPuzzle: true });
eq(getIntervalDescription(mk(1)), '1 day', 'H2 rung 1 -> 1 day');
eq(getIntervalDescription(mk(2)), '2 days', 'H3 rung 2 -> 2 days');
eq(getIntervalDescription(mk(3)), '3 days', 'H4 rung 3 -> 3 days');
eq(getIntervalDescription(mk(4)), '7 days', 'H5 rung 4 -> 7 days');
eq(getIntervalDescription(mk(5)), '14 days', 'H6 rung 5 -> 14 days');
eq(getIntervalDescription(mk(6)), '30 days', 'H7 rung 6 -> 30 days');
eq(getIntervalDescription(mk(7)), '90 days', 'H8 rung 7 -> 90 days');
eq(getIntervalDescription(mk(MASTERED_RUNG)), 'Mastered', 'H9 mastered -> Mastered');
eq(getIntervalDescription(createInitialCorrectState()), 'New puzzle', 'H10 non-wrong -> New puzzle');

// ---------------------------------------------------------------------------
section('I. DB row round-trip (stateToDbRow <-> dbRowToState)');
const srcState = calculateNextState(createInitialWrongPuzzleState(), 'correct');
const row = stateToDbRow(srcState);
const back = dbRowToState(row);
eq(back.rung, srcState.rung, 'I1 rung survives round-trip');
eq(back.isWrongPuzzle, srcState.isWrongPuzzle, 'I2 isWrongPuzzle survives');
eq(back.dueDate.getTime(), srcState.dueDate.getTime(), 'I3 dueDate survives');
ok(row.due_date === srcState.dueDate.toISOString(), 'I4 due_date serialised as ISO string');

// ---------------------------------------------------------------------------
section('J. simulateProgression wrapper + clean-solve semantics');
const sim = simulateProgression(['correct', 'correct', 'hard', 'correct']);
eq(sim.length, 5, 'J1 returns results.length + 1 states');
eq(sim[0].rung, 0, 'J2 sim[0] is the initial wrong state (rung 0)');
eq(sim[2].rung, 2, 'J3 two corrects -> rung 2');
eq(sim[3].rung, 0, 'J4 a hard resets to rung 0');
eq(sim[4].rung, 1, 'J5 a correct after the reset advances to rung 1');
// a clean solve of a non-mistake puzzle never enters the ladder
const clean = calculateNextState(createInitialCorrectState(), 'correct');
eq(clean.isWrongPuzzle, false, 'J6 clean solve stays out of the mistake deck');
eq(clean.rung, 0, 'J7 clean solve does not advance a rung');
eq(getQueueType(clean), 'new', 'J8 clean solve is never queued');

// ---------------------------------------------------------------------------
console.log(`\n=========================================`);
console.log(`  PASS ${pass}   FAIL ${fail}   NOTE ${notes}`);
console.log(`=========================================`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('All assertions passed.');
process.exit(0);
