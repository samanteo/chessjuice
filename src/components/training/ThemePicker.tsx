"use client";

import { useMemo, useState } from "react";
import {
  THEME_CATEGORIES,
  FLAT_THEME_CARDS,
  fmtCount,
  OPENINGS,
  getOpeningMeta,
  getThemeIcon,
} from "./themeCatalogue";

interface ThemePickerProps {
  open: boolean;
  onClose: () => void;
  pinned: string[];
  themeCounts: Record<string, number>;
  /** Toggle a single theme's (or opening's) pinned state. */
  onToggle: (themeId: string) => void;
  /** Pin several at once. */
  onPinMany: (themeIds: string[]) => void;
  /** Clear every pinned theme/opening (bulk escape hatch). */
  onUnpinAll?: () => void;
  /**
   * Live puzzle counts per BASE opening family (camelCase id -> count), as
   * returned by the store's getOpeningCounts(). Optional so the picker's props
   * contract stays backwards-compatible: when omitted the picker falls back to
   * the curated OPENINGS catalogue, so openings are still selectable even
   * before page.tsx wires the counts through.
   */
  openingCounts?: Record<string, number>;
}

// Reserved category value for the Openings section. Kept distinct from the real
// THEME_CATEGORIES keys so it can't collide with a theme category name.
const OPENINGS_CATEGORY = "__openings__";

// How many openings to show before the long tail is tucked behind a toggle.
// Follows the spirit of page.tsx's OPENING_PROMINENT_MIN pattern, but bounded
// so a ~1,600-opening catalogue never renders all at once.
const OPENING_VISIBLE = 24;

interface PickerItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  count: number;
  kind: "theme" | "opening";
  /** Only themes belong to a THEME_CATEGORIES key. */
  category?: string;
}

function matchesQuery(item: PickerItem, q: string): boolean {
  if (!q) return true;
  return (
    item.label.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    (item.category ? item.category.toLowerCase().includes(q) : false)
  );
}

/**
 * Modal picker over the full theme catalogue AND the opening families. Search +
 * category filter; each row toggles a theme's (or opening's) pinned state so
 * several can be pinned in one sitting. Openings are reported to the parent by
 * their camelCase base-family id (e.g. "sicilianDefense") — the same key
 * /api/dispense and the theme/opening filters expect.
 */
export function ThemePicker({
  open,
  onClose,
  pinned,
  themeCounts,
  onToggle,
  onPinMany,
  onUnpinAll,
  openingCounts = {},
}: ThemePickerProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showAllOpenings, setShowAllOpenings] = useState(false);
  // "Pin all shown" used to be ONE tap that pinned everything in view — with the
  // default "All Categories" filter that was 97 themes at once, which then filled
  // the Training tab with every theme. Now it arms first when the blast radius is
  // large, same two-tap guard the board's Skip uses.
  const [pinAllArmed, setPinAllArmed] = useState(false);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  // Flat list of all themes (with live counts) for search/filter.
  const themeItems = useMemo(() => {
    const items: PickerItem[] = [];
    Object.entries(THEME_CATEGORIES).forEach(([cat, themes]) => {
      themes.forEach((t) => {
        items.push({
          id: t.id,
          label: t.label,
          description: t.description || "",
          icon: FLAT_THEME_CARDS[t.id]?.icon || "🎯",
          category: cat,
          count: themeCounts[t.id] || 0,
          kind: "theme",
        });
      });
    });
    return items;
  }, [themeCounts]);

  // Flat list of openings. Prefers live counts (openingCounts); empty openings
  // are hidden ("no empty card" rule). Falls back to the curated catalogue when
  // no live data is wired up yet, so the section is never empty.
  const openingItems = useMemo(() => {
    const items: PickerItem[] = [];
    const hasLive = Object.keys(openingCounts).length > 0;
    if (hasLive) {
      Object.entries(openingCounts).forEach(([id, count]) => {
        if (!count || count <= 0) return;
        const meta = getOpeningMeta(id);
        items.push({
          id,
          label: meta.label,
          description: meta.description,
          icon: getThemeIcon(id),
          count,
          kind: "opening",
        });
      });
    } else {
      OPENINGS.forEach((o) => {
        items.push({
          id: o.id,
          label: o.label,
          description: o.description,
          icon: getThemeIcon(o.id),
          count: 0,
          kind: "opening",
        });
      });
    }
    items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return items;
  }, [openingCounts]);

  const q = query.trim().toLowerCase();

  const filteredThemes = useMemo(
    () =>
      themeItems.filter((t) => {
        if (category === OPENINGS_CATEGORY) return false;
        if (category !== "all" && t.category !== category) return false;
        return matchesQuery(t, q);
      }),
    [themeItems, q, category]
  );

  const filteredOpenings = useMemo(
    () =>
      openingItems.filter((o) => {
        if (category !== "all" && category !== OPENINGS_CATEGORY) return false;
        return matchesQuery(o, q);
      }),
    [openingItems, q, category]
  );

  // Searching always reveals every match; otherwise the long tail is tucked
  // behind a "show all" toggle so we never render ~1,600 rows at once.
  const showEveryOpening = showAllOpenings || q.length > 0;
  const visibleOpenings = showEveryOpening
    ? filteredOpenings
    : filteredOpenings.slice(0, OPENING_VISIBLE);
  const hiddenOpenings = filteredOpenings.length - visibleOpenings.length;

  const hasOpenings = filteredOpenings.length > 0;
  const showOpeningsSection = category === "all" || category === OPENINGS_CATEGORY;

  const unpinnedShown = [...filteredThemes, ...visibleOpenings].filter((t) => !pinnedSet.has(t.id));

  if (!open) return null;

  const renderRow = (t: PickerItem) => {
    const isPinned = pinnedSet.has(t.id);
    return (
      <button
        key={`${t.kind}-${t.id}`}
        onClick={() => onToggle(t.id)}
        data-testid={t.kind === "opening" ? `picker-opening-${t.id}` : `picker-row-${t.id}`}
        data-pinned={isPinned ? "true" : "false"}
        data-kind={t.kind}
        className={`w-full p-3 rounded-lg text-left transition-colors border ${
          isPinned
            ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700"
            : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded border text-xs font-bold ${
                isPinned
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "border-gray-300 dark:border-gray-600 text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="text-2xl flex-shrink-0">{t.icon}</span>
            <div className="min-w-0">
              <h4 className="font-medium text-gray-900 dark:text-white truncate">{t.label}</h4>
              {t.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                  {t.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-mono text-gray-600 dark:text-gray-400">
              {fmtCount(t.count)}
            </span>
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              {isPinned ? "Pinned ✓" : "Pin"}
            </span>
          </div>
        </div>
      </button>
    );
  };

  const sectionHeading = (label: string) => (
    <h3 className="px-1 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {label}
    </h3>
  );

  const toggleOpeningsStyle =
    "w-full p-3 rounded-lg text-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border border-dashed border-gray-300 dark:border-gray-600";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      data-testid="theme-picker"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Pin themes &amp; openings
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {pinned.length} pinned · pick the themes and openings you want on your Quick start
              grid.
            </p>
          </div>
          <button
            onClick={onClose}
            data-testid="picker-close"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Done
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search themes and openings..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="picker-search"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            data-testid="picker-category"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Categories</option>
            {Object.keys(THEME_CATEGORIES).map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
            <option value={OPENINGS_CATEGORY}>Openings</option>
          </select>
          {pinned.length > 0 && onUnpinAll && (
            <button
              onClick={() => { onUnpinAll(); setPinAllArmed(false); }}
              data-testid="picker-unpin-all"
              className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-700 dark:hover:text-red-300 transition-colors text-sm font-medium"
            >
              Unpin all ({pinned.length})
            </button>
          )}
          <button
            onClick={() => {
              // Small batches pin immediately; large ones ask once, because the
              // default filter can pin ~100 themes in a single tap.
              if (unpinnedShown.length > 12 && !pinAllArmed) {
                setPinAllArmed(true);
                return;
              }
              setPinAllArmed(false);
              onPinMany(unpinnedShown.map((t) => t.id));
            }}
            disabled={unpinnedShown.length === 0}
            data-testid="picker-pin-all"
            data-pin-all-armed={pinAllArmed ? "true" : "false"}
            className={`px-3 py-2 rounded-lg transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
              pinAllArmed
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {pinAllArmed
              ? `Tap again to pin ${unpinnedShown.length}`
              : `Pin all shown (${unpinnedShown.length})`}
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="picker-list">
          {filteredThemes.length === 0 && !(showOpeningsSection && hasOpenings) && (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              No themes or openings match “{query}”.
            </p>
          )}

          {filteredThemes.length > 0 && (
            <>
              {showOpeningsSection && hasOpenings && sectionHeading("Themes")}
              {filteredThemes.map(renderRow)}
            </>
          )}

          {showOpeningsSection && hasOpenings && (
            <>
              {sectionHeading("Openings")}
              {visibleOpenings.map(renderRow)}
              {hiddenOpenings > 0 && (
                <button
                  onClick={() => setShowAllOpenings(true)}
                  data-testid="picker-show-all-openings"
                  className={toggleOpeningsStyle}
                >
                  ▼ Show all {filteredOpenings.length} openings
                </button>
              )}
              {showAllOpenings && q.length === 0 && filteredOpenings.length > OPENING_VISIBLE && (
                <button
                  onClick={() => setShowAllOpenings(false)}
                  data-testid="picker-show-fewer-openings"
                  className={toggleOpeningsStyle}
                >
                  ▲ Show fewer openings
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
