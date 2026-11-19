#!/usr/bin/env python3
"""
TEST BUILD: quality-gated pool.

Keeps every pool puzzle with Popularity >= MIN_POP, drops the "<80" tier, and
backfills the freed slots from the full Lichess DB — Popularity >= BACKFILL_MIN,
same rating band (1000-2200), NOT already in the pool — bucketed by rating so
the difficulty profile is preserved.

Writes /tmp/puzzles_after.csv. Does NOT touch public/puzzles.csv.
Prints before/after aggregates only.
"""
import csv, collections, statistics, math

POOL = "public/puzzles.csv"
SRC = "lichess_db_puzzle.csv"
OUT = "/tmp/puzzles_after.csv"
MIN_POP = 80          # drop anything below this
BACKFILL_MIN = 85     # backfill quality bar (comfortably above the cut)
BUCKET = 100          # rating bucket width
LO, HI = 1000, 2200
CAP_PER_BUCKET = 40000  # bound memory

COLS = ["PuzzleId", "FEN", "Moves", "Rating", "Themes", "Popularity"]
FLOOR = 620           # per-theme coverage floor to protect (current min is 578)
THEME_CAP = 20000     # bound memory for per-theme repair candidates


def bucket(r):
    return (r // BUCKET) * BUCKET


# ---------- 1. split the current pool ----------
keep, need = [], collections.Counter()
old_stats = collections.Counter()
old_themes = collections.Counter()
with open(POOL, newline="") as f:
    for row in csv.DictReader(f):
        r = int(row["Rating"]); p = int(row["Popularity"])
        old_stats[p < MIN_POP] += 1
        for t in row["Themes"].split():
            old_themes[t] += 1
        if p >= MIN_POP:
            keep.append(row)
        else:
            need[bucket(r)] += 1

n_before = len(keep) + sum(need.values())
print(f"pool before      : {n_before:,}")
print(f"  kept (pop>={MIN_POP})  : {len(keep):,}")
print(f"  dropped (<{MIN_POP})    : {sum(need.values()):,}  ({100*sum(need.values())/n_before:.1f}%)")
print(f"  slots needed per rating bucket: {len(need)} buckets\n")

# ---------- 2. stream source for backfill candidates ----------
have = {r["PuzzleId"] for r in keep}
# Only SMALL themes can realistically fall under the floor, so we only index
# candidates for those — keeps memory bounded.
at_risk = {t for t, c in old_themes.items() if c < 10000}
print(f"at-risk themes (<10k in pool): {len(at_risk)}")
cand = collections.defaultdict(list)
themecand = collections.defaultdict(list)
scanned = 0
with open(SRC, newline="") as f:
    rd = csv.reader(f)
    hdr = next(rd)
    idx = {c: hdr.index(c) for c in COLS}
    for row in rd:
        scanned += 1
        if scanned % 2_000_000 == 0:
            print(f"  ...scanned {scanned:,}")
        try:
            r = int(row[idx["Rating"]]); p = int(row[idx["Popularity"]])
        except (ValueError, IndexError):
            continue
        if p < BACKFILL_MIN:
            continue
        pid = row[idx["PuzzleId"]]
        if pid in have:
            continue
        rec = (p, [row[idx[c]] for c in COLS])
        # Bucket backfill is restricted to the pool's rating band so difficulty
        # is preserved exactly.
        if LO <= r <= HI:
            b = bucket(r)
            if b in need and len(cand[b]) < CAP_PER_BUCKET:
                cand[b].append(rec)
        # Rare-theme repair accepts ANY rating: rare themes live mostly OUTSIDE
        # the 1000-2200 band, so an in-band-only search finds nothing to repair
        # with (that is why doubleBishopMate could not be restored).
        for t in row[idx["Themes"]].split():
            if t in at_risk:
                lst = themecand[t]
                if len(lst) < THEME_CAP:
                    lst.append(rec)
                elif p > lst[-1][0]:
                    lst[-1] = rec

print(f"scanned source: {scanned:,}\n")

# ---------- 3. backfill, highest popularity first, per bucket ----------
added, short = [], collections.Counter()
for b, want in need.items():
    pool_b = sorted(cand.get(b, []), key=lambda x: -x[0])
    take = pool_b[:want]
    added.extend(r for _, r in take)
    if len(take) < want:
        short[b] = want - len(take)

print(f"backfilled: {len(added):,}")
if short:
    print(f"  !! buckets short of candidates: {dict(short)}")
else:
    print("  every bucket fully backfilled")

# ---------- 3b. theme repair: no theme may drop below FLOOR ----------
after_rows = list(keep) + [dict(zip(COLS, r)) for r in added]
seen_pids = {r["PuzzleId"] for r in after_rows}

def theme_counts(rows):
    tc = collections.Counter()
    for r in rows:
        for t in r["Themes"].split():
            tc[t] += 1
    return tc

tc = theme_counts(after_rows)
repaired = 0
for t in sorted(at_risk, key=lambda x: tc.get(x, 0)):
    deficit = FLOOR - tc.get(t, 0)
    if deficit <= 0:
        continue
    for p, r in sorted(themecand.get(t, []), key=lambda x: -x[0]):
        if deficit <= 0:
            break
        if r[0] in seen_pids:
            continue
        seen_pids.add(r[0])
        rec = dict(zip(COLS, r))
        after_rows.append(rec)
        repaired += 1
        deficit -= 1
        for th in r[4].split():
            tc[th] += 1
print(f"theme repair added: {repaired:,}")

# ---------- 3c. trim back to the original size ----------
target = n_before
trimmed = 0
if len(after_rows) > target:
    added_rows = after_rows[len(keep):]
    added_rows.sort(key=lambda r: int(r["Popularity"]))  # lowest quality first
    drop = set()
    for r in added_rows:
        if len(after_rows) - len(drop) <= target:
            break
        ths = r["Themes"].split()
        if all(tc.get(t, 0) - 1 >= FLOOR for t in ths):
            drop.add(r["PuzzleId"])
            for t in ths:
                tc[t] -= 1
    if drop:
        after_rows = [r for r in after_rows if r["PuzzleId"] not in drop]
        trimmed = len(drop)
print(f"trimmed to size: {trimmed:,}  ->  final {len(after_rows):,} (target {target:,})")

# ---------- 4. write + report ----------
with open(OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS)
    w.writeheader()
    w.writerows(after_rows)
after = after_rows

def stats(rows, label):
    p = [int(r["Popularity"]) for r in rows]
    rat = [int(r["Rating"]) for r in rows]
    t = collections.Counter()
    for r in rows:
        for th in r["Themes"].split():
            t[th] += 1
    print(f"\n{label}: {len(rows):,} rows")
    print(f"  popularity mean {statistics.mean(p):.1f}  median {statistics.median(p)}  min {min(p)}")
    print(f"  below {MIN_POP}: {sum(1 for x in p if x < MIN_POP):,}")
    print(f"  rating mean {statistics.mean(rat):.0f}  median {statistics.median(rat)}")
    print(f"  themes {len(t)}  min/theme {min(t.values()):,} ({min(t,key=t.get)})  max {max(t.values()):,}")
    return t

before_rows = keep + [dict(zip(COLS, r)) for r in []]  # keep-only for the "before" side of backfilled cols
tb = stats(list(csv.DictReader(open(POOL))), "BEFORE (live pool)")
ta = stats(after, "AFTER (test build)")

print("\ntheme coverage deltas (top movers):")
for th in sorted(set(tb) | set(ta), key=lambda x: (ta.get(x, 0) - tb.get(x, 0)))[:5]:
    print(f"  {th:<20} {tb.get(th,0):>8,} -> {ta.get(th,0):>8,}")
print(f"\nwrote {OUT}")
