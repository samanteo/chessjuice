"use client";

import { useState, useCallback, useMemo } from "react";
import { LICHESS_THEMES, LichessTheme, THEME_DISPLAY_NAMES, WRONG_PUZZLES_THEME } from "@/types";

interface ThemeFilterProps {
  selectedThemes: LichessTheme[];
  onThemesChange: (themes: LichessTheme[]) => void;
  themeCounts?: Record<LichessTheme, number>;
  wrongPuzzlesCount?: number;
  showWrongPuzzles?: boolean;
  onWrongPuzzlesToggle?: (show: boolean) => void;
}

export function ThemeFilter({
  selectedThemes,
  onThemesChange,
  themeCounts = {} as Record<LichessTheme, number>,
  wrongPuzzlesCount = 0,
  showWrongPuzzles = false,
  onWrongPuzzlesToggle,
}: ThemeFilterProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<string[]>(["all"]);
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  // Theme categories for organization
  const themeCategories = useMemo(() => ({
    "Mate Patterns": [
      "mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
      "backRankMate", "smotheredMate", "anastasiaMate", "arabianMate",
      "bodenMate", "hookMate", "shortMate", "longMate"
    ],
    "Tactical Motifs": [
      "fork", "pin", "skewer", "doubleCheck", "discoveredAttack",
      "attraction", "interference", "intermezzo", "trappedPiece",
      "capturingDefender", "xRayAttack", "zugzwang", "quietMove"
    ],
    "Sacrifices": [
      "sacrifice", "promotion", "underPromotion"
    ],
    "Attack Patterns": [
      "kingsideAttack", "queensideAttack", "attackingF2F7", "exposedKing"
    ],
    "Endgames": [
      "endgame", "pawnEndgame", "knightEndgame", "bishopEndgame",
      "rookEndgame", "queenEndgame", "queenRookEndgame"
    ],
    "Other": [
      "advantage", "equality", "opening", "middlegame", "oneMove",
      "castling", "centralizedKing", "hangingPiece"
    ],
  }), []);

  // Filter themes based on search and selection
  const filteredThemes = useMemo(() => {
    let themes = LICHESS_THEMES.filter((theme: LichessTheme) => {
      const displayName = THEME_DISPLAY_NAMES[theme].toLowerCase();
      const matchesSearch = displayName.includes(searchQuery.toLowerCase());
      const matchesSelection = !showOnlySelected || selectedThemes.includes(theme);
      return matchesSearch && matchesSelection;
    });
    return themes;
  }, [searchQuery, showOnlySelected, selectedThemes]);

  const toggleTheme = useCallback((theme: LichessTheme) => {
    if (selectedThemes.includes(theme)) {
      onThemesChange(selectedThemes.filter(t => t !== theme));
    } else {
      onThemesChange([...selectedThemes, theme]);
    }
  }, [selectedThemes, onThemesChange]);

  const selectAll = useCallback(() => {
    onThemesChange([...LICHESS_THEMES]);
  }, [onThemesChange]);

  const clearAll = useCallback(() => {
    onThemesChange([]);
  }, [onThemesChange]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  }, []);

  // Count selected themes
  const selectedCount = selectedThemes.length;
  const totalCount = LICHESS_THEMES.length;

  return (
    <div className="theme-filter space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Themes</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={showOnlySelected}
              onChange={e => setShowOnlySelected(e.target.checked)}
              className="rounded border-gray-300"
            />
            Selected only
          </label>
          {selectedCount > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-blue-600 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Selected themes chips */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedThemes.map(theme => (
            <span
              key={theme}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs"
            >
              {THEME_DISPLAY_NAMES[theme]}
              <button
                onClick={() => toggleTheme(theme)}
                className="hover:text-blue-600"
                aria-label={`Remove ${THEME_DISPLAY_NAMES[theme]}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search themes..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
          🔍
        </span>
      </div>

      {/* Wrong Puzzles pseudo-theme */}
      {onWrongPuzzlesToggle !== undefined && (
        <div className="border-t pt-4">
          <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={showWrongPuzzles}
                onChange={e => onWrongPuzzlesToggle(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">Wrong Puzzles</span>
                <p className="text-xs text-gray-500">SM-2 review queue for failed puzzles</p>
              </div>
            </div>
            <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-mono">
              {wrongPuzzlesCount}
            </span>
          </label>
        </div>
      )}

      {/* Theme categories */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {Object.entries(themeCategories).map(([category, themes]) => {
          const categoryThemes = themes.filter((t): t is LichessTheme => LICHESS_THEMES.includes(t as LichessTheme));
          const visibleThemes = categoryThemes.filter((t: LichessTheme) => 
            filteredThemes.includes(t)
          );
          const isExpanded = expandedCategories.includes(category);
          const selectedInCategory = categoryThemes.filter(t => selectedThemes.includes(t as LichessTheme)).length;

          if (visibleThemes.length === 0 && !isExpanded) return null;

          return (
            <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCategory(category)}
                className="w-full px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-left hover:bg-gray-100 transition-colors"
              >
                <span className="font-medium text-gray-900 capitalize">{category}</span>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs font-mono">
                    {selectedInCategory}/{categoryThemes.length}
                  </span>
                  <span className="text-gray-400">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-3 space-y-1 max-h-60 overflow-y-auto">
                  {visibleThemes.map(theme => {
                    const isSelected = selectedThemes.includes(theme);
                    const count = themeCounts[theme] || 0;
                    return (
                      <label
                        key={theme}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleTheme(theme)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-900">{THEME_DISPLAY_NAMES[theme]}</span>
                        </div>
                        {count > 0 && (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-mono">
                            {count}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-500 text-center pt-2 border-t">
        {selectedCount} of {totalCount} themes selected
        {searchQuery && ` (filtered from ${filteredThemes.length} matches)`}
      </div>

      <style jsx>{`
        .theme-filter {
          font-family: inherit;
        }
        input[type="checkbox"] {
          accent-color: #2563eb;
        }
      `}</style>
    </div>
  );
}

// Compact version for toolbar
export function ThemeFilterCompact({
  selectedThemes,
  onThemesChange,
  themeCounts = {} as Record<LichessTheme, number>,
  wrongPuzzlesCount = 0,
  showWrongPuzzles = false,
  onWrongPuzzlesToggle,
}: ThemeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const toggleTheme = useCallback((theme: LichessTheme) => {
    if (selectedThemes.includes(theme)) {
      onThemesChange(selectedThemes.filter(t => t !== theme));
    } else {
      onThemesChange([...selectedThemes, theme]);
    }
  }, [selectedThemes, onThemesChange]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
      >
        <span>🏷️</span>
        <span className="font-medium">
          {selectedThemes.length > 0 
            ? `${selectedThemes.length} themes`
            : "All themes"
          }
        </span>
        {selectedThemes.length > 0 && (
          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-mono">
            {selectedThemes.length}
          </span>
        )}
        <span className="text-gray-400">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              autoFocus
            />
          </div>

          {onWrongPuzzlesToggle !== undefined && (
            <label className="flex items-center justify-between p-2 rounded hover:bg-gray-50 mb-2 cursor-pointer">
              <span className="font-medium text-red-600">Wrong Puzzles</span>
              <input
                type="checkbox"
                checked={showWrongPuzzles}
                onChange={e => onWrongPuzzlesToggle(e.target.checked)}
                className="w-4 h-4 text-blue-600"
              />
            </label>
          )}

          <div className="max-h-60 overflow-y-auto space-y-1">
            {LICHESS_THEMES
              .filter(t => THEME_DISPLAY_NAMES[t].toLowerCase().includes(searchQuery.toLowerCase()))
              .map(theme => {
                const isSelected = selectedThemes.includes(theme);
                const count = themeCounts[theme] || 0;
                return (
                  <label
                    key={theme}
                    className={`flex items-center justify-between p-1.5 rounded cursor-pointer ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTheme(theme)}
                      className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="text-sm ml-2 flex-1 truncate">{THEME_DISPLAY_NAMES[theme]}</span>
                    {count > 0 && (
                      <span className="text-xs text-gray-500 font-mono">{count}</span>
                    )}
                  </label>
                );
              })}
          </div>

          {selectedThemes.length > 0 && (
            <button
              onClick={() => onThemesChange([])}
              className="w-full mt-2 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}