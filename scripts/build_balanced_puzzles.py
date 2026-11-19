#!/usr/bin/env python3
"""
Build a balanced, theme-stratified puzzle pool for the Puzzle Trainer app.

Problem
-------
The raw Lichess puzzle database has ~4M+ puzzles split across (currently) 73
themes, but a *plain head slice* (e.g. the first 100k rows) is NOT representative:
rare themes (balestraMate, castling, underPromotion, superGM, ...) end up with
zero rows and their Training-tab cards are empty.

What this script does
---------------------
It scans the source CSV once to get per-theme totals, then builds the UNION of
per-theme samples:

  * For every theme, keep up to ``--per-theme`` K puzzles.
  * Themes whose total is below K are kept *in full*.
  * Large themes are thinned with a deterministic, id+theme-salted hash sample
    so the result is stable and re-runnable (same input -> same output).
  * A puzzle that carries several themes is written once (union), so the final
    row count is smaller than the naive sum of per-theme quotas.

The output keeps the exact 6-column format the browser already parses:

    PuzzleId,FEN,Moves,Rating,Themes,Popularity

Source selection: ``filtered_puzzles.csv`` (already 6-col, rating 1000-2200) is
used when present, otherwise the full ``lichess_db_puzzle.csv`` (11-col). Both
contain the complete theme set, including master/masterVsMaster/superGM.

Usage
-----
    python3 scripts/build_balanced_puzzles.py                    # defaults
    python3 scripts/build_balanced_puzzles.py --per-theme 6000
    python3 scripts/build_balanced_puzzles.py --input filtered_puzzles.csv \
        --output public/puzzles.csv --per-theme 6000

Re-runnable / tunable: adjust ``--per-theme`` up to grow the pool, down to
shrink it. A final per-theme table is printed and the script exits non-zero if
any theme would end up empty.
"""

import argparse
import csv
import hashlib
import os
import sys
from pathlib import Path

# Canonical output header (exactly what usePuzzleStore.ts expects).
OUT_HEADER = ["PuzzleId", "FEN", "Moves", "Rating", "Themes", "Popularity"]


def _hash_bucket(puzzle_id: str, theme: str) -> int:
    """Deterministic 64-bit bucket for (puzzle, theme)."""
    h = hashlib.blake2b(f"{puzzle_id}:{theme}".encode("utf-8"), digest_size=8)
    return int.from_bytes(h.digest(), "big")


def detect_source(explicit):
    if explicit:
        p = Path(explicit)
        if not p.exists():
            sys.exit(f"error: input not found: {p}")
        return p
    for cand in ("filtered_puzzles.csv", "lichess_db_puzzle.csv"):
        if Path(cand).exists():
            return Path(cand)
    sys.exit("error: no source CSV found (looked for filtered_puzzles.csv / lichess_db_puzzle.csv)")


def build_column_map(header: list[str]) -> dict[str, int]:
    idx = {name: i for i, name in enumerate(header)}
    missing = [c for c in OUT_HEADER if c not in idx]
    if missing:
        sys.exit(f"error: source is missing required columns: {missing}\nheader={header}")
    return idx


def count_themes(path: Path, cmap: dict[str, int]) -> tuple[int, dict[str, int]]:
    totals: dict[str, int] = {}
    rows = 0
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # header
        tcol = cmap["Themes"]
        for row in reader:
            if len(row) <= tcol:
                continue
            rows += 1
            for t in row[tcol].split():
                totals[t] = totals.get(t, 0) + 1
    return rows, totals


def write_sample(path: Path, cmap: dict[str, int], totals: dict[str, int],
                 per_theme: int, out_path: Path) -> tuple[int, dict[str, int]]:
    """Second pass: decide inclusion and stream the union to out_path."""
    id_col = cmap["PuzzleId"]
    tcol = cmap["Themes"]
    cols = [cmap[c] for c in OUT_HEADER]

    written = 0
    out_counts: dict[str, int] = {}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with path.open(newline="", encoding="utf-8") as fin, \
            out_path.open("w", newline="", encoding="utf-8") as fout:
        reader = csv.reader(fin)
        next(reader, None)
        writer = csv.writer(fout, lineterminator="\n")
        writer.writerow(OUT_HEADER)

        for row in reader:
            if len(row) <= tcol:
                continue
            pid = row[id_col]
            themes = row[tcol].split()
            if not themes:
                continue

            keep = False
            for t in themes:
                total = totals.get(t, 0)
                if total <= per_theme:
                    trained = True  # rare theme: keep everything
                else:
                    # probability ~ per_theme/total, stable per (id, theme)
                    trained = (_hash_bucket(pid, t) % total) < per_theme
                if trained:
                    keep = True
                    break

            if keep:
                writer.writerow([row[c] for c in cols])
                written += 1
                for t in themes:
                    out_counts[t] = out_counts.get(t, 0) + 1

    return written, out_counts


def main() -> None:
    ap = argparse.ArgumentParser(description="Build a theme-balanced puzzle pool.")
    ap.add_argument("--input", help="source CSV (default: filtered_puzzles.csv if present)")
    ap.add_argument("--output", default="public/puzzles.csv", help="output path")
    ap.add_argument("--per-theme", type=int, default=6000,
                    help="max puzzles kept per theme (rare themes kept in full)")
    args = ap.parse_args()

    src = detect_source(args.input)
    out_path = Path(args.output)

    print(f"Source : {src} ({src.stat().st_size / 1e6:.1f} MB)")
    print(f"Output : {out_path}")
    print(f"Per-theme quota: {args.per_theme}")
    print("Pass 1/2: counting per-theme totals ...")

    with src.open(newline="", encoding="utf-8") as f:
        header = next(csv.reader(f))
    cmap = build_column_map(header)
    total_rows, totals = count_themes(src, cmap)
    print(f"  {total_rows:,} source rows, {len(totals)} themes\n")

    print("Pass 2/2: selecting stratified union ...")
    written, out_counts = write_sample(src, cmap, totals, args.per_theme, out_path)

    # ---- report -----------------------------------------------------------
    print("\nPer-theme result (source_total -> kept):")
    width = max(len(t) for t in sorted(totals)) if totals else 10
    for t in sorted(totals):
        print(f"  {t:<{width}}  {totals[t]:>9,} -> {out_counts.get(t, 0):>7,}")

    size_mb = out_path.stat().st_size / 1e6
    print(f"\nTotal rows written: {written:,}  ({size_mb:.1f} MB)")

    empty = [t for t in totals if out_counts.get(t, 0) == 0]
    if empty:
        print(f"\nERROR: {len(empty)} theme(s) have zero puzzles: {empty}", file=sys.stderr)
        sys.exit(1)

    print(f"OK: all {len(totals)} themes are populated.")
    print(f"min kept={min(out_counts.values()):,}  max kept={max(out_counts.values()):,}")


if __name__ == "__main__":
    main()