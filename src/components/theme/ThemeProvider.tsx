"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import {
  ThemeConfig,
  BoardTheme,
  PieceSet,
  UITheme,
  DEFAULT_PREFERENCES,
  getBoardThemeCSS,
  DEFAULT_THEME_CONFIG,
} from "./themeConfig";

interface ThemeContextValue {
  config: ThemeConfig;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
  uiTheme: UITheme;
  coordinates: boolean;
  animation: boolean;
  highlightLastMove: boolean;
  highlightCheck: boolean;
  pieceAnimation: boolean;
  autoCastle: boolean;
  autoPromoteToQueen: boolean;
  blockTouchScroll: boolean;
  /** Optional per-puzzle countdown in seconds (0 = Off). */
  puzzleTimerSeconds: number;
  setBoardTheme: (theme: BoardTheme) => void;
  setPieceSet: (set: PieceSet) => void;
  setUITheme: (theme: UITheme) => void;
  setCoordinates: (enabled: boolean) => void;
  setAnimation: (enabled: boolean) => void;
  setHighlightLastMove: (enabled: boolean) => void;
  setHighlightCheck: (enabled: boolean) => void;
  setPieceAnimation: (enabled: boolean) => void;
  setAutoCastle: (enabled: boolean) => void;
  setAutoPromoteToQueen: (enabled: boolean) => void;
  setBlockTouchScroll: (enabled: boolean) => void;
  setPuzzleTimerSeconds: (seconds: number) => void;
  resetToDefaults: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreferences,
}: {
  children: ReactNode;
  initialPreferences?: Partial<typeof DEFAULT_PREFERENCES>;
}) {
  const [config] = useState<ThemeConfig>(DEFAULT_THEME_CONFIG);

  // Load preferences from localStorage
  const [prefs, setPrefs] = useState<typeof DEFAULT_PREFERENCES>(() => {
    let merged: typeof DEFAULT_PREFERENCES = { ...DEFAULT_PREFERENCES, ...initialPreferences };
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("puzzle_trainer_theme_prefs");
        if (stored) merged = { ...merged, ...JSON.parse(stored) };
      } catch {}
    }
    // Drop board themes that no longer exist (the removed textured ones) so the
    // Appearance tab always shows a valid, selected theme.
    if (!DEFAULT_THEME_CONFIG.boardThemes.some((b) => b.id === merged.boardTheme)) {
      merged = { ...merged, boardTheme: DEFAULT_PREFERENCES.boardTheme };
    }
    return merged;
  });

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem("puzzle_trainer_theme_prefs", JSON.stringify(prefs));
    const root = document.documentElement;

    // Apply board theme CSS variables
    const themeCSS = getBoardThemeCSS(prefs.boardTheme);
    Object.entries(themeCSS).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // Resolve UI theme (auto follows the OS preference)
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const resolveDark = (t: UITheme) => t === "dark" || (t === "auto" && mql.matches);
    const applyUiTheme = () => {
      root.classList.toggle("dark", resolveDark(prefs.uiTheme));
      root.setAttribute("data-theme", prefs.uiTheme);
    };
    applyUiTheme();

    // React to OS changes while in "auto"
    const onChange = () => applyUiTheme();
    mql.addEventListener?.("change", onChange);

    // Apply piece set class to body (only one set is shipped — mpchess)
    document.body.classList.remove(...DEFAULT_THEME_CONFIG.pieceSets.map((p) => p.id));
    document.body.classList.add("mpchess");

    return () => mql.removeEventListener?.("change", onChange);
  }, [prefs]);

  const updatePrefs = useCallback((updates: Partial<typeof DEFAULT_PREFERENCES>) => {
    setPrefs((prev) => ({ ...prev, ...updates }));
  }, []);

  // Mirror the puzzle-timer preference into the main settings record
  // (`puzzle_trainer_settings`) so it also lives with the user's other settings.
  // Skipped on the first render so we never create a partial settings record
  // before the store has written the real one.
  const timerMirrorMounted = useRef(false);
  useEffect(() => {
    if (!timerMirrorMounted.current) {
      timerMirrorMounted.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem("puzzle_trainer_settings");
      const cur = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        "puzzle_trainer_settings",
        JSON.stringify({ ...cur, puzzleTimerSeconds: prefs.puzzleTimerSeconds })
      );
    } catch {}
  }, [prefs.puzzleTimerSeconds]);

  const value: ThemeContextValue = {
    config,
    boardTheme: prefs.boardTheme,
    pieceSet: "mpchess" as PieceSet,
    uiTheme: prefs.uiTheme,
    coordinates: prefs.coordinates,
    animation: prefs.animation,
    highlightLastMove: prefs.highlightLastMove,
    highlightCheck: prefs.highlightCheck,
    pieceAnimation: prefs.pieceAnimation,
    autoCastle: prefs.autoCastle,
    autoPromoteToQueen: prefs.autoPromoteToQueen,
    blockTouchScroll: prefs.blockTouchScroll,
    puzzleTimerSeconds: prefs.puzzleTimerSeconds ?? 0,
    setBoardTheme: (theme) => updatePrefs({ boardTheme: theme }),
    setPieceSet: (set) => updatePrefs({ pieceSet: set }),
    setUITheme: (theme) => updatePrefs({ uiTheme: theme }),
    setCoordinates: (enabled) => updatePrefs({ coordinates: enabled }),
    setAnimation: (enabled) => updatePrefs({ animation: enabled }),
    setHighlightLastMove: (enabled) => updatePrefs({ highlightLastMove: enabled }),
    setHighlightCheck: (enabled) => updatePrefs({ highlightCheck: enabled }),
    setPieceAnimation: (enabled) => updatePrefs({ pieceAnimation: enabled }),
    setAutoCastle: (enabled) => updatePrefs({ autoCastle: enabled }),
    setAutoPromoteToQueen: (enabled) => updatePrefs({ autoPromoteToQueen: enabled }),
    setBlockTouchScroll: (enabled) => updatePrefs({ blockTouchScroll: enabled }),
    setPuzzleTimerSeconds: (seconds) => updatePrefs({ puzzleTimerSeconds: seconds }),
    resetToDefaults: () => setPrefs(DEFAULT_PREFERENCES),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}