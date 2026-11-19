#!/usr/bin/env python3
"""
Why can't rare themes be backfilled? Count the SUPPLY of rare-theme puzzles in
the full DB at various quality bars / rating bands. One streaming pass.
"""
import csv, collections

RARE = ["doubleBishopMate", "underPromotion", "balestraMate", "castling",
        "vukovicMate", "blindSwineMate", "killBoxMate", "dovetailMate"]

tot = collections.Counter()
band = collections.Counter()      # rating 1000-2200
band80 = collections.Counter()    # band AND pop>=80
band85 = collections.Counter()    # band AND pop>=85
wide85 = collections.Counter()    # any rating AND pop>=85
wide80 = collections.Counter()    # any rating AND pop>=80

with open("lichess_db_puzzle.csv", newline="") as f:
    rd = csv.reader(f)
    hdr = next(rd)
    ri, pi, ti = hdr.index("Rating"), hdr.index("Popularity"), hdr.index("Themes")
    for row in rd:
        ths = row[ti].split()
        hit = [t for t in ths if t in RARE]
        if not hit:
            continue
        try:
            r, p = int(row[ri]), int(row[pi])
        except ValueError:
            continue
        for t in hit:
            tot[t] += 1
            inband = 1000 <= r <= 2200
            if inband:
                band[t] += 1
                if p >= 80: band80[t] += 1
                if p >= 85: band85[t] += 1
            if p >= 85: wide85[t] += 1
            if p >= 80: wide80[t] += 1

print(f"{'theme':<20}{'total':>9}{'in band':>9}{'band>=80':>10}{'band>=85':>10}{'any>=85':>9}")
print("-" * 68)
for t in RARE:
    print(f"{t:<20}{tot[t]:>9,}{band[t]:>9,}{band80[t]:>10,}{band85[t]:>10,}{wide85[t]:>9,}")

print("\nread: if 'band>=85' is tiny while 'total' is large, the theme is")
print("      concentrated OUTSIDE the 1000-2200 band -> quality bar thins it.")
