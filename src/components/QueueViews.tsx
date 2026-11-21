"use client";

import { useState, useCallback, useMemo } from "react";
import { UserPuzzle, QueueType, QueueCounts, LichessTheme } from "@/types";
import { ThemeFilterCompact } from "./ThemeFilter";
import { getQueueType, getIntervalDescription, SM2State, MAX_RUNG } from "@/lib/sm2";
import { resolveAngle } from "@/lib/historySessions";
import { puzzleThemeGroup } from "@/lib/themeGroups";
import { themeLabel } from "@/components/dashboard/dashboardStats";

interface QueueViewsProps {
  puzzles: UserPuzzle[];
  queueCounts: QueueCounts;
  activeQueue: QueueType;
  onQueueChange: (queue: QueueType) => void;
  onPuzzleSelect: (puzzle: UserPuzzle) => void;
  onRemovePuzzle: (puzzleId: string) => void;
  onRestorePuzzle: (puzzleId: string) => void;
  onThemeFilterChange: (themes: LichessTheme[]) => void;
  selectedThemes: LichessTheme[];
  themeCounts: Record<LichessTheme, number>;
  wrongPuzzlesCount: number;
  showWrongPuzzles: boolean;
  onWrongPuzzlesToggle: (show: boolean) => void;
  userRating: number;
  newPuzzlesPerDay: number;
  /**
   * "Group by theme" is CONTROLLED from the page, not local state. Selecting a
   * puzzle unmounts this component (the board replaces the queue), so a local
   * useState reset the toggle on every single puzzle — the setting silently
   * dropped the moment you started reviewing. The page owns it and persists it.
   */
  groupByTheme: boolean;
  onGroupByThemeChange: (next: boolean) => void;
}

const QUEUE_CONFIG: Record<QueueType, { label: string; icon: string; description: string }> = {
  due: { label: "Due", icon: "⏰", description: "Scheduled reviews whose date has arrived" },
  new: { label: "New", icon: "✨", description: "Never attempted puzzles" },
  learning: { label: "Learning", icon: "📚", description: "Today's deck — see it again in a few minutes" },
  mastered: { label: "Mastered", icon: "🏆", description: "Scheduled ahead, or ladder completed" },
  archived: { label: "Archived", icon: "📦", description: "Manually removed puzzles" },
};

// The Mistakes tab is ONLY your mistakes. New puzzles are dispensed from the
// Training tab, so there is no "New" queue here.
const QUEUE_TABS: QueueType[] = ["due", "learning", "mastered", "archived"];

// Thousands separators for puzzle counts (100000 → 100,000)
const fmtCount = (n: number) => (n ?? 0).toLocaleString("en-US");

function formatDate(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  
  if (diff <= 0) return "Due now";
  
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 30) return `In ${Math.ceil(days/7)} weeks`;
  return `In ${Math.ceil(days/30)} months`;
}

function PuzzleQueueItem({
  puzzle,
  queue,
  interval,
  dueDate,
  onClick,
  onRemove,
  onRestore,
  userRating,
}: {
  puzzle: UserPuzzle;
  queue: QueueType;
  interval: string;
  dueDate: Date;
  onClick: () => void;
  onRemove: () => void;
  onRestore: () => void;
  userRating: number;
}) {
  const state = puzzle as unknown as SM2State;
  const isDue = queue === "due";
  const isWrongPuzzle = state.isWrongPuzzle;
  const rung = state.rung ?? 0;
  const mastered = rung > MAX_RUNG;

  const themeTags = puzzle.themes.slice(0, 3).map(t => (
    <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
      {t}
    </span>
  ));

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`queue-item-${puzzle.id}`}
      data-angle={resolveAngle({ openings: puzzle.openings, themes: puzzle.themes })}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full p-4 hover:bg-gray-50 transition-colors text-left flex items-start gap-4 cursor-pointer"
    >
      {/* Rating badge */}
      <div className="flex-shrink-0 w-16 text-center">
        <div className={`font-mono font-bold text-lg ${
          puzzle.rating >= userRating + 100 ? "text-red-600" :
          puzzle.rating <= userRating - 100 ? "text-green-600" :
          "text-gray-900"
        }`}>
          {puzzle.rating}
        </div>
        <div className="text-xs text-gray-500">Elo</div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex-1 min-w-0">
            {/* flex-wrap: the Mistake / Rung / Mastered badges are nowrap by
                default, so without wrapping they forced this row to ~237px
                inside a 170px column and spilled past the card edge. */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-medium text-gray-900 truncate">
                Puzzle #{puzzle.id}
              </span>
              {isWrongPuzzle && (
                <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                  Mistake
                </span>
              )}
              {isWrongPuzzle && !mastered && (
                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                  Rung {rung}
                </span>
              )}
              {mastered && (
                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                  Mastered
                </span>
              )}
            </div>
            
            <div className="flex flex-wrap gap-1 mb-2">
              {themeTags}
              {puzzle.themes.length > 3 && (
                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                  +{puzzle.themes.length - 3}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                📅 {interval}
              </span>
              {isDue && (
                <span className="flex items-center gap-1 text-red-600 font-medium">
                  ⏰ Due now
                </span>
              )}
              {!isDue && queue !== "new" && queue !== "archived" && (
                <span className="flex items-center gap-1">
                  📆 {formatDate(dueDate)}
                </span>
              )}
              {isWrongPuzzle && (
                <span className="flex items-center gap-1">
                  🪜 Rung {rung}/{MAX_RUNG}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex flex-col items-end gap-2">
        {queue === "archived" && (
          <button
            onClick={e => { e.stopPropagation(); onRestore(); }}
            className="px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded"
          >
            Restore
          </button>
        )}
        {queue !== "archived" && queue !== "new" && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
          >
            Archive
          </button>
        )}
      </div>
    </div>
  );
}

export function QueueViews({
  puzzles,
  queueCounts,
  activeQueue,
  onQueueChange,
  onPuzzleSelect,
  onRemovePuzzle,
  onRestorePuzzle,
  onThemeFilterChange,
  selectedThemes,
  themeCounts,
  wrongPuzzlesCount,
  showWrongPuzzles,
  onWrongPuzzlesToggle,
  userRating,
  newPuzzlesPerDay,
  groupByTheme,
  onGroupByThemeChange,
}: QueueViewsProps) {
  const [sortBy, setSortBy] = useState<"dueDate" | "rating" | "rung" | "createdAt">("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterRating, setFilterRating] = useState<{min: number, max: number} | null>(null);

  // Filter puzzles for active queue
  const queuePuzzles = useMemo(() => {
    let filtered: UserPuzzle[];
    if (activeQueue === "new") {
      // "New" is a SMALL WINDOW of never-attempted puzzles — never the whole catalog.
      // (The catalog is 100k+; dumping it into the sidebar was the bug.)
      filtered = puzzles
        .filter((p) => {
          const s = p as unknown as SM2State;
          return !s.isWrongPuzzle && !s.removedAt && (p.attempts ?? 0) === 0;
        })
        .slice(0, Math.max(1, newPuzzlesPerDay));
    } else {
      filtered = puzzles.filter((p) => {
        const s = p as unknown as SM2State;
        if (!s.isWrongPuzzle) return false; // correctly-solved puzzles aren't queued
        return getQueueType(s) === activeQueue;
      });
    }

    // Apply theme filter
    if (selectedThemes.length > 0) {
      filtered = filtered.filter(p => 
        p.themes.some(t => selectedThemes.includes(t))
      );
    }
    
    // Apply rating filter
    if (filterRating) {
      filtered = filtered.filter(p => 
        p.rating >= filterRating.min && p.rating <= filterRating.max
      );
    }
    
    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortBy) {
        case "dueDate":
          aVal = new Date((a as unknown as SM2State).dueDate).getTime();
          bVal = new Date((b as unknown as SM2State).dueDate).getTime();
          break;
        case "rating":
          aVal = a.rating;
          bVal = b.rating;
          break;
        case "rung":
          aVal = (a as unknown as SM2State).rung;
          bVal = (b as unknown as SM2State).rung;
          break;
        case "createdAt":
          aVal = new Date(a.createdAt).getTime();
          bVal = new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    
    return filtered;
  }, [puzzles, activeQueue, selectedThemes, filterRating, sortBy, sortDir, newPuzzlesPerDay]);

  /**
   * The queue batched by THEME, for the "group by theme" view.
   *
   * It used to group by ANGLE (opening). That is Lichess's opening-session key
   * and it is wrong for puzzles: ~83% of them carry no opening tag, so the whole
   * queue collapsed into one group labelled "Mixed" — a "Group by theme" button
   * producing a single bucket. Now the key is the puzzle's first real MOTIF tag
   * (see lib/themeGroups).
   *
   * Groups keep the order they already have (due first by default) and are
   * themselves ordered by size, biggest first — the motif you have most to work
   * through.
   */
  const themeGroups = useMemo(() => {
    if (!groupByTheme) return null;
    const groups = new Map<string, UserPuzzle[]>();
    for (const p of queuePuzzles) {
      const key = puzzleThemeGroup(p);
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return Array.from(groups.entries())
      .map(([theme, items]) => ({ theme, items }))
      .sort(
        (a, b) =>
          b.items.length - a.items.length ||
          themeLabel(a.theme).localeCompare(themeLabel(b.theme))
      );
  }, [queuePuzzles, groupByTheme]);

  function getPuzzleWeight(puzzleRating: number, userRating: number): number {
    // Weight based on rating difference - Lichess style
    // Peak weight at userRating + 50 (slightly challenging)
    const diff = puzzleRating - userRating;
    if (diff < -200) return 0.1;
    if (diff < -100) return 0.3;
    if (diff < -50) return 0.7;
    if (diff < 0) return 0.9;
    if (diff < 50) return 1.0;      // Sweet spot
    if (diff < 100) return 0.9;
    if (diff < 200) return 0.6;
    if (diff < 300) return 0.3;
    return 0.1;
  }

  // Get next puzzle using Lichess-style rating-based selection
  const getNextPuzzle = useCallback((): UserPuzzle | null => {
    // Grouped view: "next" means the top of the grouped list, i.e. the first
    // item of the biggest motif group — exactly what the user is looking at.
    // It used to take the flat list's first item, which could belong to a
    // different theme than the group shown at the top.
    if (groupByTheme && themeGroups && themeGroups.length > 0) {
      return themeGroups[0].items[0] ?? null;
    }

    let candidates = queuePuzzles;
    
    if (candidates.length === 0) return null;
    
    // For "new" queue, prioritize puzzles near user rating
    if (activeQueue === "new") {
      // Calculate weights
      const weights = candidates.map(p => getPuzzleWeight(p.rating, userRating));
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      
      // Weighted random selection
      let random = Math.random() * totalWeight;
      for (let i = 0; i < candidates.length; i++) {
        random -= weights[i];
        if (random <= 0) return candidates[i];
      }
    }
    
    // For other queues, sort by due date (SM-2) and take first
    return candidates[0];
  }, [queuePuzzles, activeQueue, userRating, groupByTheme, themeGroups]);

  const handleGetNextPuzzle = useCallback(() => {
    const next = getNextPuzzle();
    if (next) {
      onPuzzleSelect(next);
    }
  }, [getNextPuzzle, onPuzzleSelect]);

  const handleSort = useCallback((field: typeof sortBy) => {
    setSortBy(prev => prev === field ? prev : field);
    setSortDir(prev => prev === "asc" ? "desc" : "asc");
  }, []);

  const getQueueIcon = (queue: QueueType) => QUEUE_CONFIG[queue].icon;
  const getQueueLabel = (queue: QueueType) => QUEUE_CONFIG[queue].label;
  const getQueueCount = (queue: QueueType) => queueCounts[queue] || 0;

  const getPuzzleInterval = (puzzle: UserPuzzle) => {
    const state = puzzle as unknown as SM2State;
    return getIntervalDescription(state);
  };

  return (
    <div className="queue-views h-full flex flex-col">
      {/* Header with tabs */}
      <div className="border-b border-gray-200">
        {/* Queue tabs — WRAP instead of scrolling sideways. At 5 tabs each
            carrying an icon + label + count badge this measured ~597px inside a
            356px container, so it scrolled horizontally and looked broken. */}
        <div className="flex flex-wrap px-2">
          {QUEUE_TABS.map(queue => {
            const count = getQueueCount(queue);
            const isActive = activeQueue === queue;
            return (
              <button
                key={queue}
                onClick={() => onQueueChange(queue)}
                className={`flex-shrink-0 px-4 py-3 border-b-2 transition-colors ${
                  isActive 
                    ? "border-blue-600 text-blue-600 font-medium" 
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="flex items-center gap-1">
                  <span>{getQueueIcon(queue)}</span>
                  <span>{getQueueLabel(queue)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                    isActive ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"
                  }`}>
                    {fmtCount(count)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
        <ThemeFilterCompact
          selectedThemes={selectedThemes}
          onThemesChange={onThemeFilterChange}
          themeCounts={themeCounts}
          wrongPuzzlesCount={wrongPuzzlesCount}
          showWrongPuzzles={showWrongPuzzles}
          onWrongPuzzlesToggle={onWrongPuzzlesToggle}
        />

        <div className="flex-1"></div>

        {/* Group the queue by motif theme, and keep that grouping for the whole
            review session (the page owns + persists this flag). */}
        <button
          data-testid="queue-group-toggle"
          data-on={groupByTheme ? "1" : "0"}
          onClick={() => onGroupByThemeChange(!groupByTheme)}
          title="Group the queue by theme — next puzzle stays in the same theme"
          className={
            "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
            (groupByTheme
              ? "bg-[#d59020] text-[#1b1a17] border-transparent font-medium"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50")
          }
        >
          🗂️ Group by theme
        </button>

        {/* Get Next Puzzle button — red to match the app's Review Due button */}
        <button
          onClick={handleGetNextPuzzle}
          disabled={queuePuzzles.length === 0}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          ➡️ Get Next Puzzle
        </button>

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={e => handleSort(e.target.value as typeof sortBy)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="dueDate">Sort: Due Date</option>
          <option value="rating">Sort: Rating</option>
          <option value="rung">Sort: Rung</option>
          <option value="createdAt">Sort: Added Date</option>
        </select>

        <button
          onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
          className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          title={sortDir === "asc" ? "Ascending" : "Descending"}
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </button>

        {/* Rating range filter */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Min"
            value={filterRating?.min || ""}
            onChange={e => setFilterRating(prev => ({
              min: parseInt(e.target.value) || 1000,
              max: prev?.max || 2200
            }))}
            className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm"
            min={1000}
            max={2200}
          />
          <span className="text-gray-400">–</span>
          <input
            type="number"
            placeholder="Max"
            value={filterRating?.max || ""}
            onChange={e => setFilterRating(prev => ({
              min: prev?.min || 1000,
              max: parseInt(e.target.value) || 2200
            }))}
            className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm"
            min={1000}
            max={2200}
          />
          {filterRating && (
            <button
              onClick={() => setFilterRating(null)}
              className="text-xs text-gray-500 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Puzzle list */}
      <div className="flex-1 overflow-y-auto">
        {queuePuzzles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-gray-500">
            <div className="text-6xl mb-4">{QUEUE_CONFIG[activeQueue].icon}</div>
            <h3 className="text-lg font-medium mb-1">{QUEUE_CONFIG[activeQueue].label}</h3>
            <p className="text-sm">{QUEUE_CONFIG[activeQueue].description}</p>
            {activeQueue === "new" && (
              <p className="text-xs text-gray-400 mt-2">
                {newPuzzlesPerDay} new puzzles per day
              </p>
            )}
            {activeQueue === "due" && wrongPuzzlesCount > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                Enable "Wrong Puzzles" theme to see due reviews
              </p>
            )}
          </div>
        ) : groupByTheme && themeGroups ? (
          /* Grouped by motif theme. */
          <div data-testid="queue-grouped">
            {themeGroups.map((g) => (
              <div key={g.theme} data-testid={`queue-group-${g.theme}`}>
                <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-y border-gray-100">
                  <span className="text-xs font-semibold text-gray-800 truncate max-w-[10rem]">
                    {themeLabel(g.theme)}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 tabular-nums">
                    {g.items.length}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {g.items.map((puzzle) => (
                    <PuzzleQueueItem
                      key={puzzle.id}
                      puzzle={puzzle}
                      queue={activeQueue}
                      interval={getPuzzleInterval(puzzle)}
                      dueDate={(puzzle as unknown as SM2State).dueDate}
                      onClick={() => onPuzzleSelect(puzzle)}
                      onRemove={() => onRemovePuzzle(puzzle.id)}
                      onRestore={() => onRestorePuzzle(puzzle.id)}
                      userRating={userRating}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {queuePuzzles.slice(0, 50).map(puzzle => (
              <PuzzleQueueItem
                key={puzzle.id}
                puzzle={puzzle}
                queue={activeQueue}
                interval={getPuzzleInterval(puzzle)}
                dueDate={(puzzle as unknown as SM2State).dueDate}
                onClick={() => onPuzzleSelect(puzzle)}
                onRemove={() => onRemovePuzzle(puzzle.id)}
                onRestore={() => onRestorePuzzle(puzzle.id)}
                userRating={userRating}
              />
            ))}
            {queuePuzzles.length > 50 && (
              <div className="p-4 text-center text-xs text-gray-400">
                Showing first 50 of {fmtCount(queuePuzzles.length)}. Use “Get Next Puzzle” to continue.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="p-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Showing {fmtCount(queuePuzzles.length)} of {fmtCount(queueCounts[activeQueue] || 0)} puzzles</span>
          <span>Rating: {userRating}</span>
        </div>
      </div>
    </div>
  );
}