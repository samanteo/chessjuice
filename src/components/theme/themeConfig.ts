// Lichess Theme Configuration
// Board themes, piece sets, and UI themes

export type BoardTheme =
  | "green"
  | "brown"
  | "blue"
  | "purple"
  | "pink"
  | "olive"
  | "grey"
  | "chesscom";

export type PieceSet =
  | "cburnett"
  | "merida"
  | "alfa"
  | "mono"
  | "mpchess"
  | "kosal"
  | "maestro"
  | "tournament";

export type UITheme = "light" | "dark" | "auto";

export interface BoardThemeConfig {
  id: BoardTheme;
  name: string;
  light: string; // CSS background for light squares
  dark: string; // CSS background for dark squares
}

export interface PieceSetConfig {
  id: PieceSet;
  name: string;
  author?: string;
  preview?: string; // Preview image
}

export interface ThemeConfig {
  boardThemes: BoardThemeConfig[];
  pieceSets: PieceSetConfig[];
  uiThemes: UITheme[];
}

// Flat board palettes only — no textures, no frames.
// The default is chess.com's classic green.
export const BOARD_THEMES: BoardThemeConfig[] = [
  {
    id: "green",
    name: "Green",
    light: "#eeeed2",
    dark: "#769656",
  },
  {
    id: "brown",
    name: "Brown",
    light: "#f0d9b5",
    dark: "#b58863",
  },
  {
    id: "blue",
    name: "Blue",
    light: "#dee3e6",
    dark: "#8ca2ad",
  },
  {
    id: "purple",
    name: "Purple",
    light: "#e8d0e8",
    dark: "#8a6c8a",
  },
  {
    id: "pink",
    name: "Pink",
    light: "#f5d0e0",
    dark: "#c06c84",
  },
  {
    id: "olive",
    name: "Olive",
    light: "#e8e8d0",
    dark: "#8a8a5c",
  },
  {
    id: "grey",
    name: "Grey",
    light: "#e0e0e0",
    dark: "#808080",
  },
  {
    id: "chesscom",
    name: "Chess.com",
    light: "#ebeccd",
    dark: "#739552",
  },
];

// All Lichess piece sets
export const PIECE_SETS: PieceSetConfig[] = [
  {
    id: "cburnett",
    name: "Cburnett",
    author: "Colin Burnett",
  },
  {
    id: "merida",
    name: "Merida",
    author: "Mérida",
  },
  {
    id: "alfa",
    name: "Alfa",
    author: "Alfa",
  },
  {
    id: "mono",
    name: "Mono",
    author: "Mono",
  },
  {
    id: "mpchess",
    name: "Mpchess",
    author: "Maxime Chupin",
  },
  {
    id: "kosal",
    name: "Kosal",
    author: "Kosal",
  },
  {
    id: "maestro",
    name: "Maestro",
    author: "Maestro",
  },
  {
    id: "tournament",
    name: "Tournament",
    author: "Tournament",
  },
];

export const UI_THEMES: UITheme[] = ["light", "dark", "auto"];

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  boardThemes: BOARD_THEMES,
  pieceSets: PIECE_SETS,
  uiThemes: UI_THEMES,
};

// CSS-in-JS theme styles
export function getBoardThemeCSS(theme: BoardTheme): Record<string, string> {
  const t = BOARD_THEMES.find((bt) => bt.id === theme) || BOARD_THEMES[0];
  return {
    "--cg-light-color": t.light,
    "--cg-dark-color": t.dark,
  };
}

export function getPieceSetCSS(pieceSet: PieceSet): string {
  return pieceSet;
}

// Puzzle-timer options (seconds). 0 = Off.
export const PUZZLE_TIMER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 30, label: "30s" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 180, label: "3 min" },
];

// Default user preferences
export const DEFAULT_PREFERENCES = {
  boardTheme: "green" as BoardTheme,
  pieceSet: "mpchess" as PieceSet,
  uiTheme: "auto" as UITheme,
  coordinates: true,
  animation: true,
  highlightLastMove: true,
  highlightCheck: true,
  pieceAnimation: true,
  autoCastle: true,
  autoPromoteToQueen: true,
  blockTouchScroll: false,
  // Optional per-puzzle countdown, in seconds (0 = Off).
  puzzleTimerSeconds: 0,
};