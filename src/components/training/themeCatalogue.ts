// Shared Lichess theme catalogue.
//
// Single source of truth for the theme category data, difficulty levels and
// per-theme display metadata. Imported by BOTH the "All themes" browser tab
// and the pinned-theme picker so the 73-theme list is never duplicated.

export interface ThemeDef {
  id: string;
  label: string;
  description: string;
}

// Lichess theme categories matching /training/themes exactly.
// Every real (data-backed) Lichess theme appears exactly once, so no card is
// ever empty. Category counts shown in the UI come from live catalog data
// (themeCounts), not from these definitions.
export const THEME_CATEGORIES: Record<string, ThemeDef[]> = {
  "Phases": [
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
  "Motifs": [
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
  "Advanced": [
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
  "Mates": [
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
  "Goals": [
    { id: "equality", label: "Equality", description: "Come back from a losing position, and secure a draw or a balanced position. (eval ≤ 200cp)" },
    { id: "advantage", label: "Advantage", description: "Seize your chance to get a decisive advantage. (200cp ≤ eval ≤ 600cp)" },
    { id: "crushing", label: "Crushing", description: "Spot the opponent blunder to obtain a crushing advantage. (eval ≥ 600cp)" },
  ],
  "Lengths": [
    { id: "oneMove", label: "One-move puzzle", description: "A puzzle that is only one move long." },
    { id: "short", label: "Short puzzle", description: "Two moves to win." },
    { id: "long", label: "Long puzzle", description: "Three moves to win." },
    { id: "veryLong", label: "Very long puzzle", description: "Four moves or more to win." },
  ],
};

export type CategoryName = keyof typeof THEME_CATEGORIES;

// Difficulty levels matching Lichess
export const DIFFICULTY_LEVELS = [
  { id: "easiest", label: "Easiest", description: "Puzzles rated much lower than your rating" },
  { id: "easy", label: "Easy", description: "Puzzles rated lower than your rating" },
  { id: "normal", label: "Normal", description: "Puzzles rated around your rating" },
  { id: "hard", label: "Hard", description: "Puzzles rated higher than your rating" },
  { id: "hardest", label: "Hardest", description: "Puzzles rated much higher than your rating" },
] as const;

export type DifficultyId = typeof DIFFICULTY_LEVELS[number]["id"];

export function getThemeIcon(id: string): string {
  const iconMap: Record<string, string> = {
    "fork": "🍴", "pin": "📌", "skewer": "🍢",
    "mateIn1": "☠️", "mateIn2": "☠️", "mateIn3": "☠️", "mateIn4": "☠️", "mateIn5": "☠️",
    "backRankMate": "🏰", "smotheredMate": "🤐", "arabianMate": "🏇", "anastasiaMate": "👸",
    "balestraMate": "🤺", "blindSwineMate": "🐷", "bodenMate": "♝", "cornerMate": "📐",
    "doubleBishopMate": "♝♝", "dovetailMate": "🕊️", "epauletteMate": "👑", "hookMate": "🪝",
    "killBoxMate": "📦", "pillsburysMate": "🏰", "morphysMate": "♞", "operaMate": "🎭",
    "swallowstailMate": "🦢", "triangleMate": "📐", "vukovicMate": "🏰",
    "master": "👑", "masterVsMaster": "⚔️", "superGM": "🌟",
    "castling": "🏰", "enPassant": "♟️", "promotion": "👑", "underPromotion": "♞",
    "equality": "⚖️", "advantage": "📈", "crushing": "💥", "checkmate": "☠️",
    "oneMove": "1️⃣", "short": "2️⃣", "long": "3️⃣", "veryLong": "4️⃣",
    "opening": "📖", "middlegame": "⚔️", "endgame": "🏁",
    "advancedPawn": "♟️⬆️", "attackingF2F7": "🎯", "capturingDefender": "🛡️",
    "doubleCheck": "⚔️⚔️", "exposedKing": "👑💥", "kingsideAttack": "🏰⚔️",
    "queensideAttack": "🏰⚔️", "intermezzo": "🎭", "quietMove": "🤫",
    "xRayAttack": "👁️", "zugzwang": "😰", "attraction": "🧲", "clearance": "🧹",
    "decoy": "🎯", "trappedPiece": "🕳️", "defensiveMove": "🛡️",
    "discoveredCheck": "🔍⚔️", "collinearMove": "📏",
    "sicilianDefense": "♞", "frenchDefense": "♟️", "queensPawnGame": "♟️",
    "italianGame": "♗", "caroKannDefense": "♟️", "scandinavianDefense": "♞",
    "queensGambitDeclined": "♕", "englishOpening": "♘", "ruyLopez": "♗",
    "scotchGame": "♘", "indianDefense": "♞", "philidorDefense": "♟️",
    "kingsGambitAccepted": "♔", "kingsGambitDeclined": "♔", "kingsGambit": "♔",
    "queensGambitAccepted": "♕", "zukertortOpening": "♘", "viennaGame": "♗",
    "pircDefense": "♟️", "modernDefense": "♟️", "bishopsOpening": "♗",
    "fourKnightsGame": "♞", "russianGame": "♞", "kingsPawnGame": "♟️",
    "slavDefense": "♟️", "benoniDefense": "♟️", "englundGambit": "♟️",
    "nimzowitschDefense": "♞", "alekhineDefense": "♞", "nimzoLarsenAttack": "♗",
    "petrovsDefense": "♞", "kingsIndianDefense": "♟️", "birdOpening": "♟️",
    "owenDefense": "♟️", "horwitzDefense": "♟️", "dutchDefense": "♟️",
    "centerGame": "♟️", "vantKruijsOpening": "♟️", "elephantGambit": "♟️",
    "nimzoIndianDefense": "♞", "blackmarDiemerGambit": "♟️", "semiSlavDefense": "♟️",
    "hungarianOpening": "♟️", "rapportJobavaSystem": "♗", "threeKnightsOpening": "♞",
    "ponzianiOpening": "♟️", "ratDefense": "♟️", "kingsIndianAttack": "♞",
    "trompowskyAttack": "♗", "grobOpening": "♟️", "englishDefense": "♟️",
    "danishGambitAccepted": "♟️", "polishOpening": "♟️", "grunfeldDefense": "♟️",
    "retiOpening": "♘", "londonSystem": "♗", "catalanOpening": "♗",
    "queensIndianDefense": "♟️", "tarraschDefense": "♟️", "czechDefense": "♟️",
  };
  return iconMap[id] || "🎯";
}

// Flat theme card map (id -> display metadata) built from the categories above.
export const FLAT_THEME_CARDS: Record<string, { label: string; description: string; icon: string; category: string }> = {};
Object.entries(THEME_CATEGORIES).forEach(([category, themes]) => {
  themes.forEach(t => {
    FLAT_THEME_CARDS[t.id] = {
      label: t.label,
      description: t.description || "",
      icon: getThemeIcon(t.id),
      category,
    };
  });
});

// Thousands separators for puzzle counts (100000 → 100,000)
export const fmtCount = (n: number) => (n ?? 0).toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Opening catalogue
// ---------------------------------------------------------------------------
// Deliberately a SEPARATE export from THEME_CATEGORIES: openings are an
// independent dimension of the puzzle pool (their own CSV column) and mixing
// them into the theme list would corrupt theme counts/logic. The list below is
// metadata only (human labels + short descriptions); the COUNTS shown in the UI
// come from live catalog data (getOpeningCounts), so no card is ever empty.
//
// Covers the top ~60 openings by pool count. Any base opening present in the
// data but absent here falls back to an auto-generated label (getOpeningMeta).
export interface OpeningDef {
  id: string;
  label: string;
  description: string;
}

export const OPENINGS: OpeningDef[] = [
  { id: "sicilianDefense", label: "Sicilian Defense", description: "1.e4 c5 — Black's most combative reply to 1.e4." },
  { id: "frenchDefense", label: "French Defense", description: "1.e4 e6 — solid, with a later ...d5 strike." },
  { id: "caroKannDefense", label: "Caro-Kann Defense", description: "1.e4 c6 — a rock-solid ...d5 structure." },
  { id: "queensPawnGame", label: "Queen's Pawn Game", description: "1.d4 — the classical queenside first move." },
  { id: "italianGame", label: "Italian Game", description: "1.e4 e5 2.Nf3 Nc6 3.Bc4 — the Bc4 bishop attacks f7." },
  { id: "scandinavianDefense", label: "Scandinavian Defense", description: "1.e4 d5 — immediate central challenge." },
  { id: "queensGambitDeclined", label: "Queen's Gambit Declined", description: "1.d4 d5 2.c4 e6 — solid classical defense." },
  { id: "englishOpening", label: "English Opening", description: "1.c4 — a flexible flank opening." },
  { id: "indianDefense", label: "Indian Defense", description: "1.d4 Nf6 — hypermodern central control." },
  { id: "ruyLopez", label: "Ruy Lopez", description: "1.e4 e5 2.Nf3 Nc6 3.Bb5 — the Spanish Game." },
  { id: "scotchGame", label: "Scotch Game", description: "1.e4 e5 2.Nf3 Nc6 3.d4 — open the centre at once." },
  { id: "philidorDefense", label: "Philidor Defense", description: "1.e4 e5 2.Nf3 d6 — a compact but passive setup." },
  { id: "kingsGambitAccepted", label: "King's Gambit Accepted", description: "1.e4 e5 2.f4 exf4 — romantic attacking play." },
  { id: "zukertortOpening", label: "Zukertort Opening", description: "1.Nf3 — a flexible knight-first opening." },
  { id: "viennaGame", label: "Vienna Game", description: "1.e4 e5 2.Nc3 — prepares f4 or a quick attack." },
  { id: "pircDefense", label: "Pirc Defense", description: "…d6/…Nf6/…g6 — hypermodern against 1.e4." },
  { id: "modernDefense", label: "Modern Defense", description: "…g6 with a delayed …Nf6 — flexible hypermodernism." },
  { id: "bishopsOpening", label: "Bishop's Opening", description: "1.e4 e5 2.Bc4 — eyes on f7 before Nf3." },
  { id: "fourKnightsGame", label: "Four Knights Game", description: "Symmetric development with all four knights out." },
  { id: "russianGame", label: "Russian Game (Petrov)", description: "1.e4 e5 2.Nf3 Nf6 — counterattack the e5 pawn." },
  { id: "kingsPawnGame", label: "King's Pawn Game", description: "1.e4 — the most direct fighting move." },
  { id: "slavDefense", label: "Slav Defense", description: "1.d4 d5 2.c4 c6 — solid support for d5." },
  { id: "benoniDefense", label: "Benoni Defense", description: "…c5 with a queenside majority — sharp and modern." },
  { id: "englundGambit", label: "Englund Gambit", description: "1.d4 e5?! — a tricky trap-based gambit." },
  { id: "nimzowitschDefense", label: "Nimzowitsch Defense", description: "1.e4 Nc6 — an offbeat knight development." },
  { id: "queensGambitAccepted", label: "Queen's Gambit Accepted", description: "1.d4 d5 2.c4 dxc4 — grab the c4 pawn." },
  { id: "alekhineDefense", label: "Alekhine Defense", description: "1.e4 Nf6 — invite the pawns forward." },
  { id: "kingsGambitDeclined", label: "King's Gambit Declined", description: "Declining 2.f4 — often with 2…Bc5." },
  { id: "nimzoLarsenAttack", label: "Nimzo-Larsen Attack", description: "1.b3 — hypermodern queenside fianchetto." },
  { id: "petrovsDefense", label: "Petrov's Defense", description: "1.e4 e5 2.Nf3 Nf6 — the Russian Game." },
  { id: "kingsIndianDefense", label: "King's Indian Defense", description: "…Nf6/…g6/…Bg7/…d6 — dynamic kingside play." },
  { id: "birdOpening", label: "Bird's Opening", description: "1.f4 — an offbeat attacking system." },
  { id: "owenDefense", label: "Owen Defense", description: "…b6/…Bb7 — a fianchetto against 1.e4." },
  { id: "horwitzDefense", label: "Horwitz Defense", description: "1.d4 e6 — transposes into French structures." },
  { id: "dutchDefense", label: "Dutch Defense", description: "1.d4 f5 — an aggressive kingside space grab." },
  { id: "centerGame", label: "Center Game", description: "1.e4 e5 2.d4 exd4 — open the centre early." },
  { id: "vantKruijsOpening", label: "Van't Kruijs Opening", description: "1.e3 — a quiet flexible first move." },
  { id: "elephantGambit", label: "Elephant Gambit", description: "1.e4 e5 2.Nf3 d5?! — a dubious two-pawn gambit." },
  { id: "nimzoIndianDefense", label: "Nimzo-Indian Defense", description: "…Bb4 pinning the knight — a top-class defense." },
  { id: "blackmarDiemerGambit", label: "Blackmar-Diemer Gambit", description: "1.d4 d5 2.e4 — a sharp pawn sacrifice." },
  { id: "semiSlavDefense", label: "Semi-Slav Defense", description: "…c6 and …e6 — a rich, complex defense." },
  { id: "hungarianOpening", label: "Hungarian Opening", description: "1.g3 — a slow kingside fianchetto." },
  { id: "rapportJobavaSystem", label: "Rapport-Jobava System", description: "An offbeat system with Bf4 and a knight on c3." },
  { id: "threeKnightsOpening", label: "Three Knights Opening", description: "A quiet development scheme on both wings." },
  { id: "ponzianiOpening", label: "Ponziani Opening", description: "1.e4 e5 2.Nf3 Nc6 3.c3 — prepare d4." },
  { id: "ratDefense", label: "Rat Defense", description: "…d6 with a flexible, defensive structure." },
  { id: "kingsIndianAttack", label: "King's Indian Attack", description: "A reversed King's Indian setup for White." },
  { id: "trompowskyAttack", label: "Trompowsky Attack", description: "1.d4 Nf6 2.Bg5 — an early bishop sortie." },
  { id: "kingsGambit", label: "King's Gambit", description: "1.e4 e5 2.f4 — sacrifice for the centre." },
  { id: "grobOpening", label: "Grob Opening", description: "1.g4?! — a provocative flank push." },
  { id: "englishDefense", label: "English Defense", description: "…b6/…Bb7 against 1.d4 — queenside fianchetto." },
  { id: "danishGambitAccepted", label: "Danish Gambit Accepted", description: "1.e4 e5 2.d4 exd4 3.c3 — double-pawn sacrifice." },
  { id: "polishOpening", label: "Polish Opening", description: "1.b4 — the Sokolsky/Orangutan push." },
  { id: "grunfeldDefense", label: "Grünfeld Defense", description: "…d5/…Nf6/…g6 — strike the centre with …c5/…e5." },
  { id: "retiOpening", label: "Réti Opening", description: "1.Nf3 d5 2.c4 — hypermodern queenside play." },
  { id: "londonSystem", label: "London System", description: "A solid 1.d4 system with Bf4 and e3." },
  { id: "catalanOpening", label: "Catalan Opening", description: "1.d4 Nf6 2.c4 e6 3.g3 — queenside pressure with Bg2." },
  { id: "queensIndianDefense", label: "Queen's Indian Defense", description: "…b6/…Bb7 — control the long diagonal." },
  { id: "tarraschDefense", label: "Tarrasch Defense", description: "An isolated-queen's-pawn defense with active play." },
  { id: "czechDefense", label: "Czech Defense", description: "1.e4 d6 or 1.d4 d6 — flexible and solid." },
];

export const OPENINGS_MAP: Record<string, OpeningDef> = (() => {
  const m: Record<string, OpeningDef> = {};
  for (const o of OPENINGS) m[o.id] = o;
  return m;
})();

// camelCase -> Title Case fallback for anything not curated above
// (e.g. "kingsGambitAccepted" -> "Kings Gambit Accepted").
export function autoOpeningLabel(id: string): string {
  const spaced = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return spaced
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Resolve display metadata for a base opening id, curated or not.
export function getOpeningMeta(id: string): { label: string; description: string } {
  const cur = OPENINGS_MAP[id];
  if (cur) return { label: cur.label, description: cur.description };
  return { label: autoOpeningLabel(id), description: "" };
}
