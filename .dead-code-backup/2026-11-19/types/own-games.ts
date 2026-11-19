/**
 * Types for Own Games Analysis feature
 */

// Lichess API types
export interface LichessUser {
  id: string;
  username: string;
  title?: string;
  rating: number;
  online: boolean;
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  perf: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: {
    white: LichessGamePlayer;
    black: LichessGamePlayer;
  };
  winner?: string;
  moves: string;
  opening?: {
    eco: string;
    name: string;
  };
}

export interface LichessGamePlayer {
  user: {
    id: string;
    name: string;
    title?: string;
    rating: number;
  };
  rating: number;
  ratingDiff: number;
}

// Lichess OAuth
export interface LichessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

// Stockfish analysis types
export interface StockfishEvaluation {
  depth: number;
  seldepth: number;
  time: number;
  nodes: number;
  pv: string[];  // Principal variation in UCI
  multipv?: StockfishEvaluation[];  // Multi-PV lines
  score: {
    type: 'cp' | 'mate';
    value: number;  // centipawns or mate in N
  };
  bestMove: string;
}

export interface PositionAnalysis {
  fen: string;
  moveNumber: number;
  playerColor: 'white' | 'black';
  userMove: string;  // UCI move the user played
  bestMove: string;  // UCI best move from Stockfish
  evalBefore: number;  // cp from user's perspective
  evalAfter: number;   // cp from user's perspective
  mateIn?: number;     // if mate found
  isBlunder: boolean;  // eval drop >= 200cp
  isMissedMate: boolean;  // missed M1-M5
  missedMateIn?: number;  // 1-5 if missed mate
}

export interface GameAnalysisResult {
  gameId: string;
  username: string;
  color: 'white' | 'black';
  rating: number;
  opponentRating: number;
  timeControl: string;
  variant: string;
  date: Date;
  positions: PositionAnalysis[];
  blunders: PositionAnalysis[];
  missedMates: PositionAnalysis[];
}

// own_games table
export interface OwnGamesRow {
  id: string;  // UUID
  user_id: string;
  game_id: string;  // Lichess game ID
  fen: string;
  pgn: string;
  moves: string;
  username: string;
  color: 'white' | 'black';
  rating: number;
  opponent_name: string;
  opponent_rating: number;
  result: 'win' | 'loss' | 'draw';
  time_control: string;
  variant: string;
  played_at: string;
  analyzed_at: string | null;
  total_moves: number;
  blunder_count: number;
  missed_mate_count: number;
  created_at: string;
  updated_at: string;
}

// own_puzzles table
export interface OwnPuzzlesRow {
  id: string;  // UUID
  user_id: string;
  game_id: string;  // FK to own_games
  puzzle_type: 'missed_mate' | 'blunder';
  fen: string;
  moves: string;  // UCI solution moves
  user_move: string;  // UCI move user played
  best_move: string;  // UCI best move
  eval_before: number;
  eval_after: number;
  mate_in: number | null;  // 1-5 for missed mate, null for blunder
  centipawn_loss: number | null;  // cp loss for blunder, null for missed mate
  move_number: number;
  player_color: 'white' | 'black';
  created_at: string;
}

// Progress tracking
export interface AnalysisProgress {
  gameId: string;
  gameIndex: number;
  totalGames: number;
  currentMove: number;
  totalMoves: number;
  percentComplete: number;
  status: 'idle' | 'fetching' | 'analyzing' | 'saving' | 'complete' | 'error';
  error?: string;
  startTime: number;
  lastUpdate: number;
}

// Web Worker messages
export interface WorkerMessage {
  type: 'init' | 'analyze' | 'stop' | 'result' | 'progress' | 'error';
  payload?: any;
}

export interface AnalyzePayload {
  fen: string;
  moves: string[];  // UCI moves from current position
  depth?: number;
  multipv?: number;
}

export interface AnalysisResult {
  evaluations: StockfishEvaluation[];
  bestMove: string;
  evalCp: number;
  mateIn?: number;
}

export interface ProgressPayload {
  gameIndex: number;
  totalGames: number;
  moveIndex: number;
  totalMoves: number;
  percent: number;
}

// Supabase types extended
export interface UserSettingsRowExtended extends Record<string, any> {
  lichess_token?: string;
  lichess_refresh_token?: string;
  lichess_token_expires_at?: string;
  lichess_username?: string;
}

// Theme extension for own games
export const OWN_GAME_THEMES = ['missed-mate', 'blunder'] as const;
export type OwnGameTheme = typeof OWN_GAME_THEMES[number];