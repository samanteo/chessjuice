"use client";

import { useTheme } from "./ThemeProvider";
import { BOARD_THEMES, UI_THEMES, PUZZLE_TIMER_OPTIONS, BoardTheme, UITheme } from "./themeConfig";

export function ThemeSelector() {
  const {
    boardTheme,
    pieceSet,
    uiTheme,
    coordinates,
    animation,
    highlightLastMove,
    highlightCheck,
    pieceAnimation,
    autoCastle,
    autoPromoteToQueen,
    blockTouchScroll,
    puzzleTimerSeconds,
    setBoardTheme,
    setPieceSet,
    setUITheme,
    setCoordinates,
    setAnimation,
    setHighlightLastMove,
    setHighlightCheck,
    setPieceAnimation,
    setAutoCastle,
    setAutoPromoteToQueen,
    setBlockTouchScroll,
    setPuzzleTimerSeconds,
    resetToDefaults,
  } = useTheme();

  return (
    <div className="theme-selector p-6 space-y-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Appearance</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Customize your board, pieces, and interface. Changes apply immediately and are saved automatically.
      </p>

      {/* Board Theme */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Board Theme</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {BOARD_THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setBoardTheme(theme.id)}
              className={`relative aspect-square rounded-lg border-4 transition-all ${
                boardTheme === theme.id
                  ? "border-blue-500 ring-2 ring-blue-500 scale-105"
                  : "border-transparent hover:border-gray-300 dark:hover:border-gray-600"
              }`}
              style={{
                background: `linear-gradient(45deg, ${theme.light} 25%, transparent 25%), 
                           linear-gradient(-45deg, ${theme.light} 25%, transparent 25%), 
                           linear-gradient(45deg, transparent 75%, ${theme.light} 75%), 
                           linear-gradient(-45deg, transparent 75%, ${theme.light} 75%), 
                           ${theme.dark}`,
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
              }}
              title={theme.name}
            >
              {boardTheme === theme.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* UI Theme */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Interface Theme</h2>
        <div className="flex gap-4">
          {UI_THEMES.map((theme) => (
            <label
              key={theme}
              className={`flex-1 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                uiTheme === theme
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="uiTheme"
                value={theme}
                checked={uiTheme === theme}
                onChange={() => setUITheme(theme)}
                className="sr-only"
              />
              <span className="capitalize font-medium">{theme}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Board Options */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Board Options</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ToggleOption
            label="Coordinates"
            description="Show file (a-h) and rank (1-8) labels"
            checked={coordinates}
            onChange={setCoordinates}
          />
          <ToggleOption
            label="Animations"
            description="Animate piece movements"
            checked={animation}
            onChange={setAnimation}
          />
          <ToggleOption
            label="Highlight Last Move"
            description="Show squares of the last move"
            checked={highlightLastMove}
            onChange={setHighlightLastMove}
          />
          <ToggleOption
            label="Highlight Check"
            description="Highlight king when in check"
            checked={highlightCheck}
            onChange={setHighlightCheck}
          />
          <ToggleOption
            label="Piece Animations"
            description="Smooth piece movement and fading"
            checked={pieceAnimation}
            onChange={setPieceAnimation}
          />
          <ToggleOption
            label="Auto Castle"
            description="Automatically move rook when castling"
            checked={autoCastle}
            onChange={setAutoCastle}
          />
          <ToggleOption
            label="Auto Queen Promotion"
            description="Automatically promote to queen"
            checked={autoPromoteToQueen}
            onChange={setAutoPromoteToQueen}
          />
          <ToggleOption
            label="Block Touch Scroll"
            description="Prevent page scroll when dragging pieces"
            checked={blockTouchScroll}
            onChange={setBlockTouchScroll}
          />
        </div>
      </section>

      {/* Puzzle Timer */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Puzzle Timer</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Optional countdown while a puzzle is unsolved. When it runs out the puzzle is
          auto-failed — exactly like a wrong answer (rung 0, into the Mistakes deck, counts
          as a loss for your rating).
        </p>
        <div className="flex flex-wrap gap-2" data-testid="puzzle-timer-options">
          {PUZZLE_TIMER_OPTIONS.map((opt) => {
            const active = (puzzleTimerSeconds || 0) === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`puzzle-timer-${opt.value}`}
                onClick={() => setPuzzleTimerSeconds(opt.value)}
                aria-pressed={active}
                className={`min-w-[4.5rem] px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                  active
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Reset */}
      <section className="pt-4 border-t">
        <button
          onClick={resetToDefaults}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Reset to Defaults
        </button>
      </section>
    </div>
  );
}

function ToggleOption({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
      />
      <div>
        <div className="font-medium text-gray-900 dark:text-gray-100">{label}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{description}</div>
      </div>
    </label>
  );
}