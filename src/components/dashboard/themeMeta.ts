import { LichessTheme, THEME_DISPLAY_NAMES } from "@/types";

// ---------------------------------------------------------------------------
// Theme label + plain-English description.
// Copied from THEME_CATEGORIES in src/app/page.tsx (owned by another agent) so
// the dashboard does not depend on it. The ids/descriptions match Lichess's
// PuzzleTheme name/description exactly.
// ---------------------------------------------------------------------------
interface ThemeDef {
  id: string;
  label: string;
  description: string;
}

const THEME_CATEGORIES: Record<string, ThemeDef[]> = {
  Phases: [
    { id: "opening", label: "Opening", description: "A tactic during the first phase of the game." },
    { id: "middlegame", label: "Middlegame", description: "A tactic during the second phase of the game." },
    { id: "endgame", label: "Endgame", description: "A tactic during the last phase of the game." },
    { id: "rookEndgame", label: "Rook endgame", description: "An endgame with only rooks and pawns." },
    { id: "bishopEndgame", label: "Bishop endgame", description: "An endgame with only bishops and pawns." },
    { id: "pawnEndgame", label: "Pawn endgame", description: "An endgame with only pawns." },
    { id: "knightEndgame", label: "Knight endgame", description: "An endgame with only knights and pawns." },
    { id: "queenEndgame", label: "Queen endgame", description: "An endgame with only queens and pawns." },
    { id: "queenRookEndgame", label: "Queen and Rook", description: "An endgame with only queens, rooks and pawns." },
  ],
  "Player types": [
    { id: "master", label: "Master games", description: "Puzzles from games played by titled players." },
    { id: "masterVsMaster", label: "Master vs Master games", description: "Puzzles from games between two titled players." },
    { id: "superGM", label: "Super GM games", description: "Puzzles from games played by the best players in the world." },
  ],
  Motifs: [
    { id: "advancedPawn", label: "Advanced pawn", description: "One of your pawns is deep into the opponent position, maybe threatening to promote." },
    { id: "attackingF2F7", label: "Attacking f2 or f7", description: "An attack focusing on the f2 or f7 pawn, such as in the fried liver opening." },
    { id: "capturingDefender", label: "Capture the defender", description: "Removing a piece that is critical to defence of another piece, allowing the now undefended piece to be captured on a following move." },
    { id: "discoveredAttack", label: "Discovered attack", description: "Moving a piece that previously blocked an attack by another long range piece, such as a knight out of the way of a rook." },
    { id: "doubleCheck", label: "Double check", description: "Checking with two pieces at once, as a result of a discovered attack where both the moving piece and the unveiled piece attack the opponent's king." },
    { id: "exposedKing", label: "Exposed king", description: "A tactic involving a king with few defenders around it, often leading to checkmate." },
    { id: "fork", label: "Fork", description: "A move where a piece attacks two or more opposing pieces simultaneously." },
    { id: "hangingPiece", label: "Hanging piece", description: "A tactic involving an opponent piece being undefended or insufficiently defended and free to capture." },
    { id: "kingsideAttack", label: "Kingside attack", description: "An attack of the opponent's king, after they castled on the king side." },
    { id: "pin", label: "Pin", description: "A tactic involving pins, where a piece is unable to move without revealing an attack on a higher value piece." },
    { id: "queensideAttack", label: "Queenside attack", description: "An attack of the opponent's king, after they castled on the queen side." },
    { id: "sacrifice", label: "Sacrifice", description: "A tactic involving giving up material in the short-term, to gain an advantage again after a forced sequence of moves." },
    { id: "skewer", label: "Skewer", description: "A motif involving a high value piece being attacked, moving out the way, and allowing a lower value piece behind it to be captured or attacked, the inverse of a pin." },
    { id: "trappedPiece", label: "Trapped piece", description: "A piece is unable to escape capture as it has limited moves." },
  ],
  Advanced: [
    { id: "attraction", label: "Attraction", description: "An exchange or sacrifice encouraging or forcing an opponent piece to a square that allows a follow-up tactic." },
    { id: "clearance", label: "Clearance", description: "A move, often with tempo, that clears a square, file or diagonal for a follow-up tactical idea." },
    { id: "collinearMove", label: "Collinear move", description: "Two opposing pieces face each other, and one slides along the line of attack without capturing the enemy piece." },
    { id: "discoveredCheck", label: "Discovered check", description: "Move a piece to reveal a check from a hidden attacking piece, which often leads to a decisive advantage." },
    { id: "defensiveMove", label: "Defensive move", description: "A precise move or sequence of moves that is needed to avoid losing material or another advantage." },
    { id: "deflection", label: "Deflection", description: "A move that distracts an opposing piece from another duty that it performs, such as guarding a key square. Sometimes also called 'overloading'." },
    { id: "interference", label: "Interference", description: "Moving a piece between two opponent pieces to leave one or both opponent pieces undefended, such as a knight on a defended square between two rooks." },
    { id: "intermezzo", label: "Intermezzo", description: "Instead of playing the expected move, first interpose another move posing an immediate threat that the opponent must answer. Also known as 'Zwischenzug' or 'In between'." },
    { id: "quietMove", label: "Quiet move", description: "A move that does not check, capture, or create an immediate threat to capture. Instead, it prepares a hidden and unavoidable threat for a later move." },
    { id: "xRayAttack", label: "X-Ray attack", description: "A piece attacks or defends a square, through an enemy piece." },
    { id: "zugzwang", label: "Zugzwang", description: "The opponent is limited in the moves they can make, and all moves worsen their position." },
  ],
  Mates: [
    { id: "mate", label: "Checkmate", description: "Win the game with style." },
    { id: "mateIn1", label: "Mate in 1", description: "Deliver checkmate in one move." },
    { id: "mateIn2", label: "Mate in 2", description: "Deliver checkmate in two moves." },
    { id: "mateIn3", label: "Mate in 3", description: "Deliver checkmate in three moves." },
    { id: "mateIn4", label: "Mate in 4", description: "Deliver checkmate in four moves." },
    { id: "mateIn5", label: "Mate in 5 or more", description: "Figure out a long mating sequence." },
  ],
  "Mate themes": [
    { id: "anastasiaMate", label: "Anastasia's mate", description: "A knight and rook or queen team up to trap the opposing king between the side of the board and a friendly piece." },
    { id: "arabianMate", label: "Arabian mate", description: "A knight and a rook team up to trap the opposing king on a corner of the board." },
    { id: "backRankMate", label: "Back rank mate", description: "Checkmate the king on the home rank, when it is trapped there by its own pieces." },
    { id: "balestraMate", label: "Balestra mate", description: "A bishop delivers the checkmate, while a queen blocks the remaining escape squares." },
    { id: "blindSwineMate", label: "Blind Swine mate", description: "Two rooks team up to mate the king in an area of 2 by 2 squares." },
    { id: "bodenMate", label: "Boden's mate", description: "Two attacking bishops on criss-crossing diagonals deliver mate to a king obstructed by friendly pieces." },
    { id: "cornerMate", label: "Corner mate", description: "Confine the king to the corner using a rook or queen, and use a knight to deliver the checkmate." },
    { id: "doubleBishopMate", label: "Double bishop mate", description: "Two attacking bishops on adjacent diagonals deliver mate to a king obstructed by friendly pieces." },
    { id: "dovetailMate", label: "Dovetail mate", description: "A queen delivers mate to an adjacent king, whose only two escape squares are obstructed by friendly pieces." },
    { id: "epauletteMate", label: "Epaulette mate", description: "Two adjacent escape squares for a checked king are occupied by other pieces." },
    { id: "hookMate", label: "Hook mate", description: "Checkmate using a rook, knight, and pawn, where an opposing pawn blocks the king's escape." },
    { id: "killBoxMate", label: "Kill box mate", description: "A rook is next to the enemy king and supported by a queen that also blocks the king's escape squares." },
    { id: "morphysMate", label: "Morphy's mate", description: "A bishop delivers checkmate to the king, while a rook helps confine it." },
    { id: "operaMate", label: "Opera mate", description: "Check the king with a rook and use a bishop to defend the rook." },
    { id: "pillsburysMate", label: "Pillsbury's mate", description: "A rook delivers checkmate to the king, while a bishop helps confine it." },
    { id: "smotheredMate", label: "Smothered mate", description: "A checkmate delivered by a knight in which the mated king is unable to move because it is surrounded (or smothered) by its own pieces." },
    { id: "swallowstailMate", label: "Swallow's tail mate", description: "A checkmate pattern that visually resembles the appearance of a swallow's tail, similar to a V shape." },
    { id: "triangleMate", label: "Triangle mate", description: "The queen and rook, one square away from the enemy king, are on the same rank or file, separated by one square, forming a triangle." },
    { id: "vukovicMate", label: "Vuković mate", description: "A rook and knight team up to mate the king. The rook delivers mate while supported by a third piece, and the knight blocks the king's escape squares." },
  ],
  "Special moves": [
    { id: "castling", label: "Castling", description: "Bring the king to safety, and deploy the rook for attack." },
    { id: "enPassant", label: "En passant", description: "A tactic involving the en passant rule, where a pawn can capture an opposing pawn that has just moved next to it with its initial two-square move." },
    { id: "promotion", label: "Promotion", description: "Promote one of your pawns to a queen, rook or minor piece." },
    { id: "underPromotion", label: "Underpromotion", description: "Promotion to a knight, bishop, or rook." },
  ],
  Goals: [
    { id: "equality", label: "Equality", description: "Come back from a losing position, and secure a draw or a balanced position. (eval ≤ 200cp)" },
    { id: "advantage", label: "Advantage", description: "Seize your chance to get a decisive advantage. (200cp ≤ eval ≤ 600cp)" },
    { id: "crushing", label: "Crushing", description: "Spot the opponent blunder to obtain a crushing advantage. (eval ≥ 600cp)" },
  ],
  Lengths: [
    { id: "oneMove", label: "One-move puzzle", description: "A puzzle that is only one move long." },
    { id: "short", label: "Short puzzle", description: "Two moves to win." },
    { id: "long", label: "Long puzzle", description: "Three moves to win." },
    { id: "veryLong", label: "Very long puzzle", description: "Four moves or more to win." },
  ],
};

export interface ThemeMeta {
  label: string;
  description: string;
}

export const THEME_META: Record<string, ThemeMeta> = {};
for (const themes of Object.values(THEME_CATEGORIES)) {
  for (const t of themes) {
    THEME_META[t.id] = { label: t.label, description: t.description };
  }
}

/** Label + description for any theme id, falling back to the display name. */
export function themeMetaFor(theme: string): ThemeMeta {
  const m = THEME_META[theme];
  if (m) return m;
  return { label: THEME_DISPLAY_NAMES[theme as LichessTheme] || theme, description: "" };
}
