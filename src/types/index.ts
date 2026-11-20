/**
 * Core type definitions for the Lichess-style Puzzle Trainer
 */

// All Lichess puzzle themes (from Lichess database)
export const LICHESS_THEMES = [
  "advancedPawn", "advantage", "anastasiaMate", "arabianMate", "attackingF2F7",
  "attraction", "backRankMate", "balestraMate", "bishopEndgame", "blindSwineMate",
  "bodenMate", "capturingDefender", "castling", "clearance", "collinearMove",
  "cornerMate", "crushing", "defensiveMove", "deflection", "discoveredAttack",
  "discoveredCheck", "doubleBishopMate", "doubleCheck", "dovetailMate", "endgame",
  "enPassant", "epauletteMate", "equality", "exposedKing", "fork",
  "hangingPiece", "hookMate", "interference", "intermezzo", "killBoxMate",
  "kingsideAttack", "knightEndgame", "long", "master", "masterVsMaster",
  "mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4",
  "mateIn5", "middlegame", "morphysMate", "oneMove", "opening",
  "operaMate", "pawnEndgame", "pillsburysMate", "pin", "promotion",
  "queenEndgame", "queenRookEndgame", "queensideAttack", "quietMove", "rookEndgame",
  "sacrifice", "short", "skewer", "smotheredMate", "superGM",
  "swallowstailMate", "trappedPiece", "triangleMate", "underPromotion", "veryLong",
  "vukovicMate", "xRayAttack", "zugzwang"
] as const;

export type LichessTheme = typeof LICHESS_THEMES[number];

// Special pseudo-theme for wrong puzzles
export const WRONG_PUZZLES_THEME = "wrong-puzzles";
export type WrongPuzzlesTheme = typeof WRONG_PUZZLES_THEME;

export type Theme = LichessTheme | WrongPuzzlesTheme;

// Puzzle from Lichess database
export interface Puzzle {
  id: string;           // PuzzleId from CSV
  fen: string;          // FEN position
  moves: string;        // UCI moves (e.g., "e2e4 e7e5 g1f3")
  rating: number;       // Puzzle rating (1000-2200)
  themes: LichessTheme[];
  popularity: number;   // Popularity score
}

// User's puzzle with ladder-scheduler state
export interface UserPuzzle extends Puzzle {
  // Opening family tags (space-separated camelCase list in the pool CSV,
  // e.g. ["sicilianDefense", "sicilianDefenseDragonVariation"]). Separate from
  // `themes`; empty for ~83% of puzzles. Optional for imported puzzles.
  openings?: string[];
  // Ladder-scheduler fields
  rung: number;            // Ladder rung (0..7); 8 = mastered
  dueDate: Date;
  lastReviewed?: Date;
  lastResult?: SM2Result;
  isWrongPuzzle: boolean;
  removedAt?: Date;
  // User-specific
  userRating: number;   // User's rating when attempting
  attempts: number;     // Total attempts
  correctAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

// Ladder review result: correct advances a rung; hard == wrong (back to rung 0)
export type SM2Result = 'correct' | 'hard';

// Queue classification
export type QueueType = 'due' | 'new' | 'learning' | 'mastered' | 'archived';

// User settings/preferences
export interface UserSettings {
  userId: string;
  rating: number;              // Current user rating (starts 1000)
  ratingMin: number;           // Min puzzle rating (default 1000)
  ratingMax: number;           // Max puzzle rating (default 2200)
  themesFilter: LichessTheme[]; // Selected themes (empty = all)
  newPuzzlesPerDay: number;    // New puzzles per day (default 5)
  streak: number;              // Current streak
  maxStreak: number;           // Best streak
  totalSolved: number;         // Total puzzles solved correctly
  totalFailed: number;         // Total puzzles failed
  // Optional per-puzzle countdown, in seconds. 0 = Off (default). When it
  // expires the puzzle is auto-failed exactly like a wrong answer.
  puzzleTimerSeconds: number;
  // Puzzles per pinned theme when a Training Block run is launched. Default 10;
  // validated/clamped to 1–100 on read and on save.
  quickStartCount?: number;
  // Sound effects on/off. Mirrors the sound module's own localStorage preference
  // so the Settings tab can toggle it.
  soundEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Default settings
export const DEFAULT_SETTINGS: Omit<UserSettings, 'userId' | 'createdAt' | 'updatedAt'> = {
  rating: 1000,
  ratingMin: 1000,
  ratingMax: 2200,
  themesFilter: [],
  newPuzzlesPerDay: 5,
  streak: 0,
  maxStreak: 0,
  totalSolved: 0,
  totalFailed: 0,
  puzzleTimerSeconds: 0,
};

// Puzzle attempt result. 'hard' = the user pressed HARD on a solved puzzle
// (not solid / lucky guess) — it is treated as NOT a clean first win.
export interface PuzzleAttempt {
  puzzleId: string;
  userId: string;
  result: 'correct' | 'incorrect' | 'hard' | 'hint' | 'solution';
  userMove?: string;       // UCI move played
  expectedMove?: string;   // UCI correct move
  moveNumber: number;      // Which move in sequence
  timeSpent: number;       // Milliseconds
  hintUsed: boolean;
  solutionViewed: boolean;
  ratingBefore: number;
  ratingAfter: number;
  timestamp: Date;
  /**
   * The PUZZLE's own rating and themes, captured at attempt time.
   *
   * Required for analytics once dispensing serves from the 6.19M server catalogue:
   * the dashboard can no longer join attempts against an in-memory catalogue,
   * because most served puzzles are not in the local CSV pool. Optional so
   * attempts recorded before this change still load (the dashboard falls back
   * to the catalogue for those).
   */
  puzzleRating?: number;
  /** The puzzle's REAL rating deviation from the catalogue (Lichess ships it). */
  puzzleDeviation?: number | null;
  themes?: string[];
  /**
   * The puzzle's opening tags, captured at attempt time. Needed for
   * opening-angle session grouping (lila groups history by `PuzzleAngle`,
   * which is an opening OR a theme).
   */
  openings?: string[];
  /**
   * The angle this round was played under, when known. lila stores this on the
   * round document; we record it when the dispenser knows it, otherwise
   * `resolveAngle()` derives it from `openings` (falling back to "mix").
   */
  angle?: string;
}

// Queue counts for UI
export interface QueueCounts {
  due: number;
  new: number;
  learning: number;
  mastered: number;
  archived: number;
}

// Filter state for puzzle selection
export interface PuzzleFilter {
  ratingMin: number;
  ratingMax: number;
  themes: LichessTheme[];
  queue: QueueType | 'all';
  includeWrongPuzzles: boolean;
}

// Theme with count for UI
export interface ThemeCount {
  theme: LichessTheme;
  count: number;
  selected: boolean;
}

// Puzzle player state
export interface PlayerState {
  puzzle: UserPuzzle | null;
  currentMoveIndex: number;
  userMoves: string[];     // UCI moves played
  isComplete: boolean;
  isCorrect: boolean | null;
  hintUsed: boolean;
  solutionViewed: boolean;
  startTime: number;
  streak: number;
  rating: number;
}

// Move validation result
export interface MoveValidation {
  isCorrect: boolean;
  isLegal: boolean;
  expectedMove: string;
  expectedSan: string;     // SAN notation
  explanation?: string;
}

// Hint result
export interface HintResult {
  piece: string;           // Piece type (e.g., "Knight")
  square: string;          // From square (e.g., "g1")
  cost: number;            // Rating points cost
}

// Supabase row types
export interface UserPuzzlesRow {
  id: string;
  user_id: string;
  puzzle_id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  popularity: number;
  rung: number;
  ease_factor: number;
  interval_days: number;
  repetition: number;
  due_date: string;
  last_reviewed: string | null;
  last_result: string | null;
  is_wrong_puzzle: boolean;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  rating: number;
  rating_min: number;
  rating_max: number;
  themes_filter: string[];
  new_puzzles_per_day: number;
  streak: number;
  max_streak: number;
  total_solved: number;
  total_failed: number;
  created_at: string;
  updated_at: string;
}

// Convert Supabase row to UserPuzzle
export function rowToUserPuzzle(row: UserPuzzlesRow): UserPuzzle {
  return {
    id: row.puzzle_id,
    fen: row.fen,
    moves: row.moves,
    rating: row.rating,
    themes: row.themes as LichessTheme[],
    popularity: row.popularity,
    rung: typeof row.rung === 'number' ? row.rung : 0,
    dueDate: new Date(row.due_date),
    lastReviewed: row.last_reviewed ? new Date(row.last_reviewed) : undefined,
    lastResult: row.last_result as SM2Result | undefined,
    isWrongPuzzle: row.is_wrong_puzzle,
    removedAt: row.removed_at ? new Date(row.removed_at) : undefined,
    userRating: 0, // Filled in at runtime
    attempts: 0,
    correctAttempts: 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Convert Supabase row to UserSettings
export function rowToUserSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    rating: row.rating,
    ratingMin: row.rating_min,
    ratingMax: row.rating_max,
    themesFilter: row.themes_filter as LichessTheme[],
    newPuzzlesPerDay: row.new_puzzles_per_day,
    streak: row.streak,
    maxStreak: row.max_streak,
    totalSolved: row.total_solved,
    totalFailed: row.total_failed,
    puzzleTimerSeconds: 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Theme display names for UI
export const THEME_DISPLAY_NAMES: Record<LichessTheme, string> = {
  advancedPawn: "Advanced Pawn",
  advantage: "Advantage",
  anastasiaMate: "Anastasia's Mate",
  arabianMate: "Arabian Mate",
  attackingF2F7: "Attacking f2/f7",
  attraction: "Attraction",
  backRankMate: "Back Rank Mate",
  balestraMate: "Balestra Mate",
  bishopEndgame: "Bishop Endgame",
  blindSwineMate: "Blind Swine Mate",
  bodenMate: "Boden's Mate",
  capturingDefender: "Capture the Defender",
  castling: "Castling",
  clearance: "Clearance",
  collinearMove: "Collinear Move",
  cornerMate: "Corner Mate",
  crushing: "Crushing",
  defensiveMove: "Defensive Move",
  deflection: "Deflection",
  discoveredAttack: "Discovered Attack",
  discoveredCheck: "Discovered Check",
  doubleBishopMate: "Double Bishop Mate",
  doubleCheck: "Double Check",
  dovetailMate: "Dovetail Mate",
  endgame: "Endgame",
  enPassant: "En Passant",
  epauletteMate: "Epaulette Mate",
  equality: "Equality",
  exposedKing: "Exposed King",
  fork: "Fork",
  hangingPiece: "Hanging Piece",
  hookMate: "Hook Mate",
  interference: "Interference",
  intermezzo: "Intermezzo / Zwischenzug",
  killBoxMate: "Kill Box Mate",
  kingsideAttack: "Kingside Attack",
  knightEndgame: "Knight Endgame",
  long: "Long Puzzle",
  master: "Master Games",
  masterVsMaster: "Master vs Master",
  mate: "Checkmate",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  mateIn4: "Mate in 4",
  mateIn5: "Mate in 5",
  middlegame: "Middlegame",
  morphysMate: "Morphy's Mate",
  oneMove: "One-Move Puzzle",
  opening: "Opening",
  operaMate: "Opera Mate",
  pawnEndgame: "Pawn Endgame",
  pillsburysMate: "Pillsbury's Mate",
  pin: "Pin",
  promotion: "Promotion",
  queenEndgame: "Queen Endgame",
  queenRookEndgame: "Queen + Rook Endgame",
  queensideAttack: "Queenside Attack",
  quietMove: "Quiet Move",
  rookEndgame: "Rook Endgame",
  sacrifice: "Sacrifice",
  short: "Short Puzzle",
  skewer: "Skewer",
  smotheredMate: "Smothered Mate",
  superGM: "Super GM Games",
  swallowstailMate: "Swallow's Tail Mate",
  trappedPiece: "Trapped Piece",
  triangleMate: "Triangle Mate",
  underPromotion: "Underpromotion",
  veryLong: "Very Long Puzzle",
  vukovicMate: "Vuković Mate",
  xRayAttack: "X-Ray Attack",
  zugzwang: "Zugzwang",
};