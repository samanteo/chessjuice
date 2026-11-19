"use client";

import { useMemo } from "react";
import { PuzzleAttempt, UserPuzzle, THEME_DISPLAY_NAMES, LichessTheme } from "@/types";

interface ThemeMasteryProps {
  attempts: PuzzleAttempt[];
  puzzles: UserPuzzle[];
  /** Minimum attempts a theme needs before it is shown (default 1). */
  minAttempts?: number;
}

interface ThemeStat {
  theme: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number;
}

// Keep the panel compact; still report how many were hidden.
const MAX_SHOWN = 12;

export function ThemeMastery({ attempts, puzzles, minAttempts = 1 }: ThemeMasteryProps) {
  const stats = useMemo<ThemeStat[]>(() => {
    // Map puzzleId -> themes from the in-memory catalog (defaultdictionary).
    const themeByPuzzle = new Map<string, LichessTheme[]>();
    for (const p of puzzles) themeByPuzzle.set(p.id, p.themes);

    const acc: Record<string, { correct: number; total: number }> = {};
    for (const a of attempts) {
      const themes = themeByPuzzle.get(a.puzzleId);
      if (!themes || themes.length === 0) continue;
      // 'correct' is a success; incorrect / hint / solution all count against you.
      const isCorrect = a.result === "correct";
      for (const t of themes) {
        if (!acc[t]) acc[t] = { correct: 0, total: 0 };
        acc[t].total++;
        if (isCorrect) acc[t].correct++;
      }
    }

    return Object.entries(acc)
      .filter(([, v]) => v.total >= minAttempts)
      .map(([theme, v]) => ({
        theme,
        label: THEME_DISPLAY_NAMES[theme as LichessTheme] || theme,
        correct: v.correct,
        total: v.total,
        accuracy: Math.round((v.correct / v.total) * 100),
      }))
      // Worst-first: lowest accuracy surfaces at the top.
      .sort((a, b) => a.accuracy - b.accuracy || a.label.localeCompare(b.label));
  }, [attempts, puzzles, minAttempts]);

  // Empty state — no attempts yet, or catalog not mapped (still loading).
  if (attempts.length === 0 || stats.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400">
        <div className="text-4xl mb-2">🎯</div>
        <p className="text-sm font-medium">No theme data yet</p>
        <p className="text-xs mt-1 max-w-[16rem]">
          Solve some puzzles and your weakest themes will surface here, worst first.
        </p>
      </div>
    );
  }

  const shown = stats.slice(0, MAX_SHOWN);

  const barColor = (acc: number) => {
    if (acc < 50) return "bg-red-500";
    if (acc < 70) return "bg-amber-500";
    if (acc < 85) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="space-y-2.5">
      {shown.map((s) => (
        <div key={s.theme} data-theme={s.theme} data-accuracy={s.accuracy}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="font-medium text-gray-900 dark:text-white truncate" title={s.label}>
              {s.label}
            </span>
            <span className="tabular-nums text-gray-500 dark:text-gray-400 ml-2 shrink-0">
              {s.accuracy}%{" "}
              <span className="text-xs">
                ({s.correct}/{s.total})
              </span>
            </span>
          </div>
          <div
            className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden"
            role="progressbar"
            aria-valuenow={s.accuracy}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full ${barColor(s.accuracy)}`}
              style={{ width: `${s.accuracy}%` }}
            />
          </div>
        </div>
      ))}
      {stats.length > MAX_SHOWN && (
        <p className="text-xs text-gray-400 pt-1">
          Showing {MAX_SHOWN} of {stats.length} themes.
        </p>
      )}
    </div>
  );
}
