"use client";

import type { ReactNode } from "react";

/**
 * Monochrome SVG theme glyphs — one consistent family.
 *
 * Every glyph is drawn on a 24x24 grid with a shared stroke weight (1.7),
 * `stroke="currentColor"`, `fill="none"` (occasional filled accents use
 * `fill="currentColor"`), so the whole set inherits text colour and reads as a
 * single family at ~20px in both light and dark mode.
 *
 * Usage:
 *   <ThemeIcon theme="fork" size={20} className="text-blue-500" />
 */

export type ThemeIconSize = number | string;

export interface ThemeIconProps {
  /** Theme id, e.g. "fork", "backRankMate", "rookEndgame". */
  theme: string;
  /** Square size in px (number) or any CSS length. Default 20. */
  size?: ThemeIconSize;
  className?: string;
  /** Accessible label; when omitted the icon is aria-hidden. */
  title?: string;
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

const PAWN_PATH =
  "M12 4a2.5 2.5 0 0 0-1.6 4.4A3.5 3.5 0 0 0 8.5 15H9l-1 6h8l-1-6h.5a3.5 3.5 0 0 0-1.9-6.6A2.5 2.5 0 0 0 12 4z";

function MateGlyph({ n }: { n?: number }): ReactNode {
  return (
    <>
      <path d="M5 19 3.5 9.5 8 12.5 12 6l4 6.5 4.5-3L19 19z" />
      <path d="M5 19h14" />
      {n != null ? (
        <text
          x="12"
          y="23.5"
          textAnchor="middle"
          fontSize="7.5"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
          fontFamily="ui-monospace, monospace"
        >
          {n}
        </text>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyph table                                                                */
/* -------------------------------------------------------------------------- */

const GLYPHS: Record<string, ReactNode> = {
  /* --- tactical motifs --- */
  fork: (
    <>
      <path d="M12 21v-6" />
      <path d="M12 15 6 8" />
      <path d="M12 15 18 8" />
      <circle cx="6" cy="6.5" r="2.4" />
      <circle cx="18" cy="6.5" r="2.4" />
    </>
  ),
  pin: (
    <>
      <path d="M2 12h20" />
      <circle cx="11" cy="12" r="3" />
      <path d="M20 9.5v5M17.5 12h5" />
    </>
  ),
  skewer: (
    <>
      <path d="M3 3l18 18" />
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="17" r="2.2" />
    </>
  ),
  discoveredAttack: (
    <>
      <circle cx="8" cy="16" r="3" />
      <path d="M15 9h6M18 6v6" />
      <path d="M11 13 15 9" strokeDasharray="2 2" />
    </>
  ),
  discoveredCheck: (
    <>
      <circle cx="8" cy="16" r="3" />
      <path d="M15 9h6M18 6v6" />
      <path d="M11 13 15 9" strokeDasharray="2 2" />
      <path d="M17 3l1.2 2.2L20.4 6 18.2 7.2 17 9.4l-1.2-2.2L13.6 6l2.2-0.8z" fill="currentColor" stroke="none" />
    </>
  ),
  doubleCheck: (
    <>
      <path d="M9 3 4.5 13H8l-.8 8 5.3-10H9z" fill="currentColor" stroke="none" />
      <path d="M18 4l-3.2 7.4h2.4l-.6 6.6L20.4 11H18z" fill="currentColor" stroke="none" />
    </>
  ),
  hangingPiece: (
    <>
      <path d="M12 3v5" />
      <path d="M12 8a4 4 0 0 0 8 0" />
      <circle cx="12" cy="17" r="3.2" />
    </>
  ),
  trappedPiece: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  sacrifice: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M12 10v9" />
      <path d="M8 15.5 12 19.5 16 15.5" />
    </>
  ),
  promotion: (
    <>
      <circle cx="12" cy="16.5" r="2.8" />
      <path d="M12 3v9" />
      <path d="M8 7l4-4 4 4" />
    </>
  ),
  underPromotion: (
    <>
      <path d={PAWN_PATH} />
      <path d="M20 12l-3 3-1.4-1.4" />
    </>
  ),
  enPassant: (
    <>
      <circle cx="8" cy="16" r="2.6" />
      <circle cx="16" cy="16" r="2.6" />
      <path d="M8 13 13 8" />
      <path d="M10.5 8H13v2.5" />
    </>
  ),
  castling: (
    <>
      <rect x="3" y="8" width="5" height="8" rx="1" />
      <rect x="16" y="8" width="5" height="8" rx="1" />
      <path d="M9 12h6M11 10l-2 2 2 2M13 14l2-2-2-2" />
    </>
  ),

  /* --- mates --- */
  mateIn1: <MateGlyph n={1} />,
  mateIn2: <MateGlyph n={2} />,
  mateIn3: <MateGlyph n={3} />,
  mateIn4: <MateGlyph n={4} />,
  mateIn5: <MateGlyph n={5} />,
  checkmate: <MateGlyph />,
  backRankMate: (
    <>
      <path d="M3 20h18" />
      <rect x="4" y="15" width="5" height="5" />
      <rect x="9.5" y="15" width="5" height="5" />
      <rect x="15" y="15" width="5" height="5" />
      <path d="M8 4l5 5M13 4l-5 5" />
    </>
  ),
  smotheredMate: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <circle cx="12" cy="12" r="7" strokeDasharray="2 2.5" />
    </>
  ),
  arabianMate: (
    <>
      <rect x="4" y="14" width="7" height="7" rx="1" />
      <path d="M16 3 9.5 12h4l-2 9 8-11h-4.6z" fill="currentColor" stroke="none" />
    </>
  ),

  /* --- phases --- */
  opening: (
    <>
      <path d="M12 19V8" />
      <path d="M4 5h4.5a3.5 3.5 0 0 1 3.5 3.5V19a3 3 0 0 0-3-2H4z" />
      <path d="M20 5h-4.5a3.5 3.5 0 0 0-3.5 3.5V19a3 3 0 0 1 3-2h5z" />
    </>
  ),
  middlegame: (
    <>
      <path d="M5 4l10 10M19 4 9 14" />
      <path d="M4 20l3-3M17 20l3-3" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  endgame: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h11l-2.5 3.5L17 11H6z" />
    </>
  ),

  /* --- endgame piece types --- */
  rookEndgame: (
    <>
      <path d="M6 20V9h12v11" />
      <path d="M6 9V5h2.5v2h2.5V5h2v2H15.5V5H18v4" />
      <path d="M4 20h16" />
    </>
  ),
  bishopEndgame: (
    <>
      <path d="M12 3c3 3 4 6 4 9H8c0-3 1-6 4-9z" />
      <path d="M10 12a2 2 0 0 0 4 0M12 7.5v3" />
      <path d="M6 21h12" />
    </>
  ),
  knightEndgame: (
    <>
      <path d="M9 21h9c0-2.6-1.2-4-1.2-6.4C16.8 10 14 8 11.5 8L10 6 6.5 8.5 8.5 12l-2.5.5 2 2.5-1 6" />
    </>
  ),
  pawnEndgame: (
    <>
      <path d={PAWN_PATH} />
    </>
  ),
  queenEndgame: (
    <>
      <path d="M6 20 4 8l4 3 4-7 4 7 4-3-2 12z" />
      <path d="M4 20h16" />
    </>
  ),

  /* --- strength / mastery --- */
  master: (
    <>
      <path d="M5 19 3.5 9.5 8 12.5 12 6l4 6.5 4.5-3L19 19z" />
      <path d="M5 19h14" />
    </>
  ),
  masterVsMaster: (
    <>
      <path d="M5 18 3.5 9l4.5 3L12 6l4 6 4.5-3L19 18z" />
      <path d="M9 21h6" />
    </>
  ),

  /* --- attacks / positional --- */
  kingsideAttack: (
    <>
      <path d="M3 6h11M12 3l3 3-3 3" />
      <path d="M3 12h11M12 9l3 3-3 3" />
      <path d="M3 18h11M12 15l3 3-3 3" />
    </>
  ),
  queensideAttack: (
    <>
      <path d="M21 6H10M12 3 9 6l3 3" />
      <path d="M21 12H10M12 9l-3 3 3 3" />
      <path d="M21 18H10M12 15l-3 3 3 3" />
    </>
  ),
  quietMove: (
    <>
      <circle cx="6.5" cy="17.5" r="2.2" />
      <path d="M9 15.5 15 9.5" strokeDasharray="2 2" />
      <circle cx="17.5" cy="6.5" r="2.2" fill="currentColor" />
    </>
  ),
  zugzwang: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M9 9 6.5 6.5M15 9l2.5-2.5M9 15l-2.5 2.5M15 15l2.5 2.5" />
    </>
  ),
  deflection: (
    <>
      <path d="M5 19 11 13" />
      <path d="M11 13a7 7 0 0 0 9 3.5" />
      <path d="M20 16.5l-2.6-1 1-2.6" />
    </>
  ),
  clearance: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" strokeDasharray="2 2" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
      <path d="M11 9 16 4M16 4h-3M16 4v3" />
    </>
  ),
  interference: (
    <>
      <path d="M4 12h16" />
      <path d="M12 4v16" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    </>
  ),
  xRayAttack: (
    <>
      <circle cx="8" cy="12" r="2.6" />
      <path d="M11 12h9" strokeDasharray="2 2" />
      <path d="M18 9.5 20.5 12 18 14.5" />
    </>
  ),
  intermezzo: (
    <>
      <path d="M4 6v12M20 6v12" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  attackingF2F7: (
    <>
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  capturingDefender: (
    <>
      <path d="M12 3l7 3v6c0 4-3 6.5-7 9-4-2.5-7-5-7-9V6z" />
      <path d="M6.5 6.5 17.5 17.5" />
    </>
  ),
  exposedKing: (
    <>
      <path d="M8 19h8l-1-7-2.5 2L12 9l-3.5 5L7 12z" />
      <path d="M4 5l2 2M20 5l-2 2M4 20l2.5-2.5M20 20l-2.5-2.5" />
    </>
  ),
  advancedPawn: (
    <>
      <path d={PAWN_PATH} />
      <path d="M20 13V5M17.5 8.5 20 6l2.5 2.5" strokeWidth="1.6" />
    </>
  ),

  /* --- eval / misc used by the grid --- */
  equality: (
    <>
      <path d="M4 9h16M4 15h16" />
      <path d="M12 3v18" strokeDasharray="2 2" />
    </>
  ),
  advantage: (
    <>
      <path d="M4 19h16" />
      <path d="M5 19V13M10 19V9M15 19V12M20 19V5" />
    </>
  ),
  crushing: (
    <>
      <path d="M12 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4L7.5 16.8l.9-5L4.8 8.3l5-.7z" />
    </>
  ),
};

/* -------------------------------------------------------------------------- */
/* Alias / normalisation                                                       */
/* -------------------------------------------------------------------------- */

const ALIASES: Record<string, string> = {
  attraction: "deflection", // magnetic pull = deflection
  decoy: "deflection",
  collinearMove: "xRayAttack",
  defensiveMove: "capturingDefender",
  kingsidePawnStorm: "kingsideAttack",
  queensidePawnStorm: "queensideAttack",
  superGM: "master",
  short: "mateIn2",
  long: "mateIn3",
  veryLong: "mateIn4",
  oneMove: "mateIn1",
  mateIn: "checkmate",

  // opening families — all preposition/opening glyphs
  sicilianDefense: "opening",
  frenchDefense: "opening",
  queensPawnGame: "opening",
  italianGame: "opening",
  caroKannDefense: "opening",
  scandinavianDefense: "opening",
  queensGambitDeclined: "opening",
  englishOpening: "opening",
  ruyLopez: "opening",
  scotchGame: "opening",
  indianDefense: "opening",
  philidorDefense: "opening",
};

/** Fallback glyph for unknown themes — a small chess target. */
const FALLBACK: ReactNode = (
  <>
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </>
);

function resolve(theme: string): ReactNode {
  if (!theme) return FALLBACK;
  const direct = GLYPHS[theme];
  if (direct) return direct;
  const alias = ALIASES[theme];
  if (alias && GLYPHS[alias]) return GLYPHS[alias];
  // case-insensitive match
  const lower = theme.toLowerCase();
  const found = Object.keys(GLYPHS).find((k) => k.toLowerCase() === lower);
  if (found) return GLYPHS[found];
  return FALLBACK;
}

export const THEME_ICON_IDS: string[] = Object.keys(GLYPHS);

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export default function ThemeIcon({
  theme,
  size = 20,
  className = "",
  title,
}: ThemeIconProps) {
  const dim = typeof size === "number" ? `${size}px` : size;
  const glyph = resolve(theme);

  return (
    <svg
      viewBox="0 0 24 24"
      width={dim}
      height={dim}
      stroke="currentColor"
      fill="none"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-theme-icon={theme}
    >
      {glyph}
    </svg>
  );
}
