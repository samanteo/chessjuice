#!/usr/bin/env python3
"""
CSV Import Script for Lichess Puzzle Database
Filters puzzles by rating 1000-2200, extracts all themes.
Outputs filtered CSV for Supabase import or localStorage.

Usage:
    python3 import_puzzles.py --input lichess_db_puzzle.csv --output filtered_puzzles.csv
    python3 import_puzzles.py --input lichess_db_puzzle.csv --supabase --user-id <uuid>
"""

import argparse
import csv
import sys
import os
from pathlib import Path
from typing import List, Set, Dict, Any
from datetime import datetime
import json

# All known Lichess themes (from Lichess puzzle database)
LICHESS_THEMES = {
    "advantage", "anastasiaMate", "arabianMate", "attackingF2F7", "attraction",
    "backRankMate", "bishopEndgame", "bodenMate", "castling", "capturingDefender",
    "centralizedKing", "doubleCheck", "endgame", "equality", "exposedKing",
    "fork", "hangingPiece", "hookMate", "interference", "intermezzo",
    "kingsideAttack", "knightEndgame", "longMate", "mate", "mateIn1", "mateIn2",
    "mateIn3", "mateIn4", "mateIn5", "middlegame", "oneMove", "opening",
    "pawnEndgame", "pin", "promotion", "queenEndgame", "queenRookEndgame",
    "queensideAttack", "quietMove", "rookEndgame", "sacrifice", "shortMate",
    "skewer", "smotheredMate", "trappedPiece", "underPromotion", "xRayAttack",
    "zugzwang"
}

RATING_MIN = 1000
RATING_MAX = 2200

def parse_themes(themes_str: str) -> List[str]:
    """Parse space-separated themes string into list."""
    if not themes_str:
        return []
    return [t.strip() for t in themes_str.split() if t.strip() in LICHESS_THEMES]

def validate_rating(rating_str: str) -> int:
    """Validate and return rating as int."""
    try:
        return int(rating_str)
    except ValueError:
        return 0

def filter_puzzle(row: Dict[str, str]) -> bool:
    """Check if puzzle passes rating filter."""
    rating = validate_rating(row.get("Rating", "0"))
    return RATING_MIN <= rating <= RATING_MAX

def process_csv(input_path: str, output_path: str, limit: int = None) -> Dict[str, Any]:
    """Process CSV file, filter by rating, return stats."""
    stats = {
        "total_read": 0,
        "total_written": 0,
        "rating_rejected": 0,
        "theme_counts": {},
        "rating_distribution": {}
    }

    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    print(f"Reading from {input_path}...")
    print(f"Rating filter: {RATING_MIN}-{RATING_MAX}")

    with open(input_path, 'r', newline='', encoding='utf-8') as infile:
        reader = csv.DictReader(infile)

        # Verify required columns
        required_cols = {"PuzzleId", "FEN", "Moves", "Rating", "Themes", "Popularity"}
        if not required_cols.issubset(set(reader.fieldnames or [])):
            missing = required_cols - set(reader.fieldnames or [])
            raise ValueError(f"Missing required columns: {missing}")

        with open(output_path, 'w', newline='', encoding='utf-8') as outfile:
            fieldnames = ["PuzzleId", "FEN", "Moves", "Rating", "Themes", "Popularity"]
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()

            for row in reader:
                stats["total_read"] += 1

                if limit and stats["total_written"] >= limit:
                    break

                if not filter_puzzle(row):
                    stats["rating_rejected"] += 1
                    continue

                # Parse and validate themes
                themes = parse_themes(row.get("Themes", ""))
                for theme in themes:
                    stats["theme_counts"][theme] = stats["theme_counts"].get(theme, 0) + 1

                # Track rating distribution
                rating = validate_rating(row.get("Rating", "0"))
                bucket = (rating // 100) * 100
                stats["rating_distribution"][bucket] = stats["rating_distribution"].get(bucket, 0) + 1

                # Write filtered row
                writer.writerow({
                    "PuzzleId": row["PuzzleId"],
                    "FEN": row["FEN"],
                    "Moves": row["Moves"],
                    "Rating": row["Rating"],
                    "Themes": row["Themes"],
                    "Popularity": row["Popularity"]
                })
                stats["total_written"] += 1

                if stats["total_written"] % 10000 == 0:
                    print(f"  Written {stats['total_written']} puzzles...")

    print(f"\nImport complete!")
    print(f"  Total read: {stats['total_read']}")
    print(f"  Total written: {stats['total_written']}")
    print(f"  Rating rejected: {stats['rating_rejected']}")
    print(f"  Unique themes found: {len(stats['theme_counts'])}")
    print(f"  Rating distribution: {dict(sorted(stats['rating_distribution'].items()))}")

    return stats

def generate_supabase_inserts(input_path: str, user_id: str, output_path: str, limit: int = None) -> int:
    """Generate SQL INSERT statements for Supabase."""
    count = 0
    with open(input_path, 'r', newline='', encoding='utf-8') as infile, \
         open(output_path, 'w', encoding='utf-8') as outfile:

        reader = csv.DictReader(infile)
        outfile.write("-- Generated Supabase inserts for user_puzzles\n")
        outfile.write(f"-- User ID: {user_id}\n")
        outfile.write(f"-- Generated: {datetime.now().isoformat()}\n\n")

        for row in reader:
            if limit and count >= limit:
                break

            if not filter_puzzle(row):
                continue

            themes = parse_themes(row.get("Themes", ""))
            themes_array = "{" + ",".join(f'"{t}"' for t in themes) + "}"

            # Escape single quotes in FEN and moves
            fen = row["FEN"].replace("'", "''")
            moves = row["Moves"].replace("'", "''")

            sql = f"""INSERT INTO user_puzzles (user_id, puzzle_id, fen, moves, rating, themes, popularity, is_wrong_puzzle)
VALUES ('{user_id}', '{row["PuzzleId"]}', '{fen}', '{moves}', {row["Rating"]}, '{themes_array}', {row["Popularity"]}, FALSE)
ON CONFLICT (user_id, puzzle_id) DO NOTHING;\n"""
            outfile.write(sql)
            count += 1

            if count % 1000 == 0:
                print(f"  Generated {count} inserts...")

    print(f"Generated {count} INSERT statements to {output_path}")
    return count

def main():
    parser = argparse.ArgumentParser(description="Import and filter Lichess puzzles")
    parser.add_argument("--input", required=True, help="Input CSV file (lichess_db_puzzle.csv)")
    parser.add_argument("--output", help="Output filtered CSV file")
    parser.add_argument("--supabase", action="store_true", help="Generate Supabase INSERT SQL")
    parser.add_argument("--user-id", help="User UUID for Supabase inserts")
    parser.add_argument("--sql-output", help="Output SQL file for Supabase inserts")
    parser.add_argument("--limit", type=int, help="Limit number of puzzles to process")
    parser.add_argument("--stats-only", action="store_true", help="Only show stats, don't write output")

    args = parser.parse_args()

    if args.supabase and not args.user_id:
        parser.error("--user-id required when using --supabase")
    if args.supabase and not args.sql_output:
        parser.error("--sql-output required when using --supabase")
    if not args.supabase and not args.output and not args.stats_only:
        parser.error("--output required unless --supabase or --stats-only")

    # Process CSV
    stats = process_csv(args.input, args.output or "/dev/null", args.limit)

    if args.supabase:
        generate_supabase_inserts(args.input, args.user_id, args.sql_output, args.limit)

    # Save stats
    stats_file = Path(args.output or "filtered_puzzles.csv").with_suffix(".stats.json")
    with open(stats_file, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"Stats saved to {stats_file}")

if __name__ == "__main__":
    main()