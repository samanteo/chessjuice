#!/usr/bin/env python3
"""
One pass over the sources answering:
  - what % of puzzles are below Rating 1000 (the user's question)
  - the exact rating histogram
  - popularity cumulative counts at >=95/97/98/99/100
Streams; keeps only counters. Aggregates only.
"""
import csv, sys

FILES = [
    ("lichess_db_puzzle.csv", "FULL Lichess DB (all puzzles)"),
    ("filtered_puzzles.csv", "filtered_puzzles.csv (rated 1000-2200)"),
    ("public/puzzles.csv",   "public/puzzles.csv (what ships)"),
]

BUCKETS = [(0,599),(600,799),(800,999),(1000,1199),(1200,1399),(1400,1599),
           (1600,1799),(1800,1999),(2000,2199),(2200,2399),(2400,2599),(2600,9999)]

for path, label in FILES:
    try:
        f = open(path, newline="")
    except FileNotFoundError:
        print(f"--- {label}: MISSING ---\n"); continue
    r = csv.reader(f)
    hdr = next(r)
    try:
        ri = hdr.index("Rating"); pi = hdr.index("Popularity")
    except ValueError:
        print(f"--- {label}: no Rating/Popularity columns (hdr={hdr}) ---\n"); f.close(); continue

    n = 0; under1k = 0; under10 = 0; under12 = 0
    hist = {b: 0 for b in BUCKETS}
    pop = {95:0, 97:0, 98:0, 99:0, 100:0}
    for row in r:
        try:
            rat = int(row[ri]); p = int(row[pi])
        except (ValueError, IndexError):
            continue
        n += 1
        if rat < 1000: under1k += 1
        if rat < 1000: under10 += 1
        if rat <= 1200: under12 += 1
        for b in BUCKETS:
            if b[0] <= rat <= b[1]:
                hist[b] += 1; break
        for t in pop:
            if p >= t: pop[t] += 1
    f.close()

    print(f"--- {label} ---")
    print(f"rows parsed: {n:,}")
    print(f"RATING < 1000 : {under1k:,}  = {100*under1k/n:.1f}%")
    print(f"RATING <= 1200: {under12:,}  = {100*under12/n:.1f}%")
    print(f"  rating histogram:")
    for b in BUCKETS:
        if hist[b]:
            print(f"    {b[0]:>4}-{b[1] if b[1]<9999 else 'max':<4}: {hist[b]:>10,}  ({100*hist[b]/n:5.1f}%)")
    print(f"  popularity thresholds (how many are available):")
    for t in (95,97,98,99,100):
        print(f"    >={t:>3}: {pop[t]:>10,}  ({100*pop[t]/n:5.1f}%)")
    print()
