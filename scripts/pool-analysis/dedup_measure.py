#!/usr/bin/env python3
"""
Measure redundancy among puzzles in ONE theme of the live pool.

Answers: if we cluster by tactically-meaningful signatures, how many puzzles
collapse into the same cluster? (i.e. how much of the pool is near-duplicate)

Pure stdlib: parses FEN + the UCI Moves list by hand, no chess library needed.
Prints ONLY aggregates so the output stays tiny.
"""
import csv, sys, collections

THEME = sys.argv[1] if len(sys.argv) > 1 else "fork"
POOL = "public/puzzles.csv"

PIECE_VAL = {"p": 1, "n": 3, "b": 3, "r": 5, "q": 9}


def parse_board(fen):
    """FEN placement -> {(file,r1..8): piece_char}"""
    b = {}
    for r, row in enumerate(fen.split()[0].split("/")):
        f = 0
        for ch in row:
            if ch.isdigit():
                f += int(ch)
            else:
                b[(f, 8 - r)] = ch
                f += 1
    return b


def sq(s):
    return (ord(s[0]) - 97, int(s[1]))


def apply_move(board, uci):
    """Naive UCI apply. Returns (captured_piece_char_or_None)."""
    frm, to = sq(uci[:2]), sq(uci[2:4])
    piece = board.get(frm)
    if piece is None:
        return None
    captured = board.get(to)
    # en passant: pawn moves diagonally onto an empty square
    if piece.lower() == "p" and frm[0] != to[0] and to not in board:
        captured = board.get((to[0], frm[1]))
        board.pop((to[0], frm[1]), None)
    board.pop(frm, None)
    if len(uci) == 5:  # promotion
        piece = uci[4].upper() if piece.isupper() else uci[4]
    board[to] = piece
    return captured


def material_key(board):
    w = collections.Counter()
    b = collections.Counter()
    for p in board.values():
        (w if p.isupper() else b)[p.lower()] += 1
    return "%s/%s" % (
        "".join(f"{t}{w[t]}" for t in "qnrbp" if w[t]),
        "".join(f"{t}{b[t]}" for t in "qnrbp" if b[t]),
    )


def material_imbalance(board):
    """Single integer: white_minor_material - black_minor_material."""
    d = 0
    for p in board.values():
        v = PIECE_VAL.get(p.lower(), 0)
        d += v if p.isupper() else -v
    return d


rows = []
with open(POOL, newline="") as f:
    for row in csv.DictReader(f):
        if THEME in row["Themes"].split():
            rows.append(row)

total = len(rows)
print(f"theme '{THEME}': {total:,} puzzles in the pool\n")

s_fen = collections.Counter()        # S1 strict: exact position (placement only)
s_tac = collections.Counter()        # S2 tactical: material+imbalance+key piece+target+capture
s_tac_coarse = collections.Counter()  # S3 coarse: material+key piece only

for row in rows:
    fen = row["FEN"]
    moves = row["Moves"].split()
    board = parse_board(fen)
    mat = material_key(board)
    imb = material_imbalance(board)
    s_fen[" ".join(fen.split()[:2])] += 1

    key_piece, dest, cap = "?", "?", "-"
    if len(moves) >= 2:
        apply_move(board, moves[0])          # opponent's auto-played setup move
        frm2, to2 = sq(moves[1][:2]), sq(moves[1][2:4])
        kp = board.get(frm2)
        if kp:
            key_piece = kp.lower()
            # normalise the destination to a RELATIVE idea, not an absolute square:
            cap = board.get(to2)
            cap = cap.lower() if cap else "-"
            dest = f"{to2[0] if to2[0] < 4 else 7 - to2[0]}"  # file folded to queenside/kingside
    s_tac[f"{mat}|{imb}|{key_piece}|{dest}|{cap}"] += 1
    s_tac_coarse[f"{mat}|{key_piece}"] += 1

def report(name, c):
    n = len(c)
    biggest = c.most_common(1)[0][1]
    dup_rows = total - n
    print(f"{name}")
    print(f"   distinct clusters : {n:,}")
    print(f"   reducible rows    : {dup_rows:,}  ({100*dup_rows/total:.0f}% removable)")
    print(f"   biggest cluster   : {biggest:,} puzzles sharing one signature")
    print()

report("S1  exact position (FEN placement+side)", s_fen)
report("S2  tactical (material|imbalance|key piece|folded dest|capture)", s_tac)
report("S3  coarse (material|key piece)", s_tac_coarse)

print("bottom line:")
print(f"   deduping this theme by S2 keeps ~{len(s_tac):,} representative puzzles")
print(f"   instead of {total:,}  ->  {100*len(s_tac)/total:.0f}% of the original size")
