#!/usr/bin/env python3
"""
Is the current pool QUALITY-BIASED, or effectively a random sample?

Compares the Popularity distribution of public/puzzles.csv against the full
lichess_db_puzzle.csv source (-1 file, streamed; only aggregates kept in RAM).
Prints aggregates only.
"""
import csv, sys, statistics

FULL = "lichess_db_puzzle.csv"
POOL = "public/puzzles.csv"


def pop_col(path, limit=None):
    vals = []
    with open(path, newline="") as f:
        r = csv.reader(f)
        hdr = next(r)
        try:
            i = hdr.index("Popularity")
        except ValueError:
            print(f"  !! no Popularity column in {path}; header={hdr}", file=sys.stderr)
            return vals, hdr
        for n, row in enumerate(r):
            if limit and n >= limit:
                break
            try:
                vals.append(int(row[i]))
            except (ValueError, IndexError):
                pass
    return vals, hdr


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(len(v) * p / 100))]


print("=== POOL (what the app ships today) ===")
pool, ph = pop_col(POOL)
print(f"rows={len(pool):,}  mean={statistics.mean(pool):.1f}  median={statistics.median(pool)}")
print(f"  p10={pct(pool,10)}  p25={pct(pool,25)}  p50={pct(pool,50)}  p75={pct(pool,75)}  p90={pct(pool,90)}")
print(f"  share with Popularity>=80: {100*sum(1 for x in pool if x>=80)/len(pool):.1f}%")
print(f"  share with Popularity>=90: {100*sum(1 for x in pool if x>=90)/len(pool):.1f}%")
print(f"  share with Popularity<50 : {100*sum(1 for x in pool if x<50)/len(pool):.1f}%")
print()

print("=== FULL SOURCE (lichess_db_puzzle.csv, streamed) ===")
full, fh = pop_col(FULL)
if full:
    print(f"rows={len(full):,}  mean={statistics.mean(full):.1f}  median={statistics.median(full)}")
    print(f"  p10={pct(full,10)}  p25={pct(full,25)}  p50={pct(full,50)}  p75={pct(full,75)}  p90={pct(full,90)}")
    print(f"  share with Popularity>=80: {100*sum(1 for x in full if x>=80)/len(full):.1f}%")
    print(f"  share with Popularity>=90: {100*sum(1 for x in full if x>=90)/len(full):.1f}%")
    print(f"  share with Popularity<50 : {100*sum(1 for x in full if x<50)/len(full):.1f}%")
    print()
    print("=== VERDICT ===")
    pm, fm = statistics.mean(pool), statistics.mean(full)
    print(f"  pool mean popularity {pm:.1f} vs full-source {fm:.1f}  ->  delta {pm-fm:+.1f}")
    print("  " + ("POOL IS QUALITY-BIASED (already selects good puzzles)" if pm > fm + 2 else
                  "POOL LOOKS LIKE A RANDOM SAMPLE (quality upgrade would pay off)"))
    print()
    print(f"  headroom: full source has {sum(1 for x in full if x>=85):,} puzzles with Popularity>=85")
    print(f"            the pool ships {sum(1 for x in pool if x>=85):,} of them")
