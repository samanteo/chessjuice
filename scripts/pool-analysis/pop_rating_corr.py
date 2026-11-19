#!/usr/bin/env python3
"""
Does high Popularity correlate with LOW difficulty?

If yes, filling the pool with top-decile-popularity puzzles would quietly make
it an EASY pool (bad for training). Cross-tabulates popularity tier vs rating.
One streaming pass; prints one small table.
"""
import csv, statistics, collections

TIERS = [("<80", 0, 79), ("80-89", 80, 89), ("90-94", 90, 94),
         ("95-97", 95, 97), ("98", 98, 98), ("99", 99, 99), ("100", 100, 100)]

ratings = collections.defaultdict(list)
n = 0
with open("lichess_db_puzzle.csv", newline="") as f:
    r = csv.reader(f)
    hdr = next(r)
    ri, pi = hdr.index("Rating"), hdr.index("Popularity")
    for row in r:
        try:
            rat, p = int(row[ri]), int(row[pi])
        except (ValueError, IndexError):
            continue
        n += 1
        for name, lo, hi in TIERS:
            if lo <= p <= hi:
                ratings[name].append(rat)
                break

print(f"full DB rows: {n:,}")
print(f"overall mean rating: {statistics.mean([v for vs in ratings.values() for v in vs]):.0f}\n")
print(f"{'popularity':<12}{'count':>10}{'mean rating':>13}{'median':>9}{'% below 1200':>14}")
print("-" * 58)
for name, _, _ in TIERS:
    v = ratings[name]
    if not v:
        continue
    below12 = 100 * sum(1 for x in v if x < 1200) / len(v)
    print(f"{name:<12}{len(v):>10,}{statistics.mean(v):>13.0f}{statistics.median(v):>9.0f}{below12:>13.1f}%")

print("\nreading: if 'mean rating' FALLS as popularity rises, popularity tracks EASINESS.")
