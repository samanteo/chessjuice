# SM-2 / Anki scheduler audit — `src/lib/sm2.ts`

Audited against **Reference 1** (the user's written product spec — the contract) and
**Reference 2** (real Anki SM-2 behaviour). Where the two references conflict, Reference 1 wins.

Verification: `node scripts/verify-sm2.mjs` (imports the real `src/lib/sm2.ts` via Node 26
native TS type-stripping — no re-implementation). **86 PASS / 0 FAIL / 7 NOTE, exit 0.**

## Rule-by-rule verdict

| # | Rule (source) | What the code does | Verdict |
|---|---|---|---|
| 1 | New puzzle failed → **10 min**, same session (R1) | `createInitialWrongPuzzleState`: `due = now + learningSteps[0]` = `[10,1440][0]` = 10 min; `repetition=0` (L63) | **MATCH** |
| 2 | Failed again → **1 day** (R1) | `calculateNextState('again')`: `due = now + relearningSteps[0]` = `[1440][0]` = 1 day (L119) | **MATCH** |
| 3 | Correct after failing → **1 day** (R1) | `'good'` at `repetition===0` → `repetition=1`, `due = now + learningSteps[1]` = 1440 min = 1 day (L144-145) | **MATCH** |
| 4 | … → **3 days** (R1) | `'good'` at `repetition===1` → `intervalDays = firstInterval` = 3 (L148-150) | **MATCH** |
| 5 | … → **7d → 14d → 30d → 90d** (R1) | Review branch does `intervalDays = round(interval × ease)` (L154). 3 → **8** → 20 → 50 → 125 | **AMBIGUOUS** — R1 also says "interval × Ease"; the literal ladder (×2.33/×2/×2.14/×3) is not any single ease multiplier |
| 6 | Correct **first try** → 3d → 7d → 14d → 30d → Archived (R1) | `createInitialCorrectState` = 3d, but `isWrongPuzzle=false`; `calculateNextState` early-returns for non-wrong (L103-109) and all queues filter them out | **AMBIGUOUS** — deliberate "Mistakes tab holds only mistakes"; ladder unreachable |
| 7 | Failed at **any later stage** → reset to **1 day** (R1) | `'again'` → `due = now + relearningSteps[0]` = 1 day (L119) — **not** 10 min | **MATCH** |
| 8 | Ease starts **2.5** (R1) | Both initial states set `easeFactor: 2.5` (L66, L83) | **MATCH** |
| 9 | **Easy: +0.15** (R1) | `easeFactorIncrement.easy = 0.15`, applied at L161 | **MATCH** |
| 10 | Easy: **interval × Ease** (R1) | Review uses `round(interval × currentEase × 1.3)` (L176) — extra 1.3 bonus + uses *old* ease | **AMBIGUOUS** — R2 allows an easy bonus; R1 does not mention it |
| 11 | **Hard: −0.20** (R1) | Was `hard: -0.15`; **now `-0.20`** | **MISMATCH → FIXED** |
| 12 | Hard: **interval stays short** (R1) | `'hard'` at review resets `repetition=0, intervalDays=0`, due 1 day (L134-136) | **AMBIGUOUS** — "short" vs full relearning reset |
| 13 | **Again: reset to 10 min** (R1) | `'again'` → 1 day (L119) | **AMBIGUOUS** — R1's own "failed at any later stage → 1 day" conflicts; code honours 1-day |
| 14 | Queues: Due / New (5/day) / Learning / Mastered (R1) | `getQueueType` + store slices `newPerDay` | **MATCH** (with #15) |
| 15 | **Mastered (archived after 90 days)** (R1) | `getQueueType` returns `'mastered'` for *every* future review, and `'archived'` only for `removedAt` (L196-221) | **AMBIGUOUS** — nothing auto-archives; the `intervalDays>=90` check is a no-op (both branches return `'mastered'`) |
| 16 | **HARD:** never deleted for a correct answer (R1) | `calculateNextState` never sets `removedAt`; only `removePuzzle()` (manual) does | **MATCH** |
| 17 | **HARD:** wrong puzzles auto-added, no Save button (R1) | `recordAttempt` calls `createInitialWrongPuzzleState()` on an incorrect attempt automatically | **MATCH** |
| 18 | **HARD:** daily review before new puzzles unlock (R1) | Not enforced anywhere — see store bugs below | **MISMATCH** (store/page, not `sm2.ts`) |
| 19 | Anki: Again −0.20 / Hard −0.15 / Easy +0.15 / Good 0 (R2) | After fix: again −0.20, hard −0.20 (R1 wins), easy +0.15, good 0 | **MISMATCH vs R2 on Hard by design** (R1 precedence) |
| 20 | Anki: ease floored at **1.30** (R2) | `Math.max(minEaseFactor, …)` on Hard (L124) and Again (L118-121) | **MATCH** |
| 21 | Anki: Again is a **lapse**, reduces ease 0.20, does **not** reset to 2.5 (R2) | Was `easeFactor = 2.5`; **now** `max(1.3, ease − 0.20)` | **MISMATCH → FIXED** |
| 22 | Anki: intervals clamped to a **maximum** (R2) | No max clamp — 15 correct answers → 478,050 days | **AMBIGUOUS** — R1 gives no cap |
| 23 | Anki: learning steps are **minutes** (R2) | `learningSteps = [10, 1440]` (10 min then **1 day**) | **AMBIGUOUS** — R1 explicitly wants 10 min / 1 day |

## Changes made to `src/lib/sm2.ts`

1. **`hard` ease delta −0.15 → −0.20** (config interface comment L34, `DEFAULT_SM2_CONFIG` L51).
   Justification: Reference 1 explicitly says "Hard: −0.20"; the file's own header comment also
   said −0.20, so −0.15 was a typo. Reference 2 (Anki) uses −0.15, but Reference 1 wins.
2. **`again` (lapse) now applies ease −0.20 instead of resetting to 2.5** (config L35/L52 +
   the `'again'` case body L113-124). Justification: Reference 2 is explicit (a lapse REDUCES ease,
   it does not wipe it to 2.5); Reference 1 is silent, and the file's header comment never mentions
   an ease reset on Again — so the 2.5-reset was an undocumented artifact. Ease is floored at 1.30.
   *This is the one change grounded in Reference 2 rather than an explicit Reference 1 rule.*
3. **Corrected the misleading comments** in the `'again'` case ("Reset to 10 minutes" → 1 day) and
   the header (ease line). No behaviour change.

Nothing else was touched. The public export set is unchanged.

## Bugs in `src/hooks/usePuzzleStore.ts` (NOT edited — another agent owns it)

1. **L466-473** — a correct answer on a never-failed puzzle calls `createInitialCorrectState()`
   (`isWrongPuzzle:false`). Because `calculateNextState` early-returns for non-wrong puzzles
   (`sm2.ts:103-109`) and every queue filters non-wrong puzzles out (`usePuzzleStore.ts:552-556`,
   `563-569`; `QueueViews.tsx:213-217`; and `isNewCandidate` requires `attempts===0`, L539-545),
   the puzzle lands in **no queue at all** and the R1 "3d → 7d → 14d → 30d → Archived" ladder can
   never run. AMBIGUOUS product decision (Mistakes-only) — reported, not fixed.
2. **L466-469** — every repeat correct answer on an already-correct puzzle re-runs
   `createInitialCorrectState()`, resetting `dueDate` to now+3d each time. Harmless today (never
   surfaced) but the stored interval is meaningless.
3. **L471 / L479** — the store only ever passes `'good'` / `'again'`. `'hard'` / `'easy'` are never
   emitted by the UI (`PuzzlePlayer.tsx` emits only `'correct'`/`'incorrect'`), so the Hard/Easy
   ease deltas and their whole branches are dead in production. If per-button grading is intended,
   the UI must pass it through.
4. **Reference 1 HARD RULE "daily review must be done before new puzzles unlock" is not enforced.**
   `getPuzzlesByQueue('new')` (L547-559) and `QueueViews.tsx:203-211` just slice
   `newPuzzlesPerDay`; `dueCount` is only used to render reminder badges
   (`page.tsx:475-482, 521-528, 838-845, 879-886`). Nothing gates or defers new-puzzle dispensing
   while `dueCount > 0`.

## Minor / cosmetic (not fixed)

- `getQueueType` L210-215: the `intervalDays >= 90` branch and the fall-through both `return 'mastered'` — dead branch.
- `getIntervalDescription`: 7–10 days render as `"1 weeks"`, and singletons pluralise (`"1 months"`, `"1 years"`). Mapping is correct; format unspecified in R1.
