"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Training BLOCKS — up to three named, independently saved training sets.
 *
 * A block owns:
 *   - its ordered theme list (`themes`) — duplicates are legal and mean "run this
 *     theme again", so the same theme can occupy two rounds;
 *   - its own position (`themeIndex` + `done`) — so starting, continuing or
 *     restarting one block can never touch another.
 *
 * Deliberately NOT owned here: how many puzzles come from each theme. That is a
 * single GLOBAL number (settings.quickStartCount) — the user asked for one knob —
 * so totals are computed from the CURRENT value every time they are read. The
 * consequence, which is the point of "global": changing that number in Settings
 * re-scales every block's total.
 *
 * Storage: one synced key holding `{ selected, blocks[] }`. The whole object is
 * replaced on write (last-writer-wins per key, exactly like the single-block key
 * it replaces) — it is not append-only, so it must NOT go in stateSync's
 * MERGE_KEYS.
 *
 * Migration: the first load after this shipped has no blocks key. It rebuilds
 * Block 1 from the old keys so the user's existing pinned themes AND their place
 * in the run carry over instead of vanishing.
 */

/** Synced storage key (the `puzzle_trainer_` prefix opts into stateSync). */
export const BLOCKS_KEY = "puzzle_trainer_blocks";
/** Pre-block keys — read ONCE for migration, never written again. */
const LEGACY_PINS_KEY = "puzzle_trainer_pinned_themes";
const LEGACY_RUN_KEY = "puzzle_trainer_quickrun";

/** Three blocks fit the Training row on a phone. More would have to scroll. */
export const MAX_BLOCKS = 3;

export interface TrainingBlock {
  id: string;
  name: string;
  /** Ordered theme/opening ids for every round — duplicates included. */
  themes: string[];
  /** Which theme in `themes` is being served. `themes.length` = finished. */
  themeIndex: number;
  /** Puzzles finished WITHIN the current theme. */
  done: number;
  /**
   * FURTHEST position this block has ever reached, in the same units as
   * `themeIndex`/`done` (NOT in raw puzzles).
   *
   * This is what makes the GLOBAL bar honest: finishing a block and restarting
   * it must not remove its contribution, and finishing it twice must not add a
   * second time. Only the first run through a round counts, so the bar is
   * `Σ min(credit, total)` — monotone, and immune to restarts.
   *
   * Stored as a position rather than a puzzle count so that changing the global
   * puzzles-per-theme in Settings re-scales credit along with everything else
   * instead of silently meaning a different number of puzzles.
   */
  credit: { themeIndex: number; done: number };
}

interface Stored {
  selected: string | null;
  blocks: TrainingBlock[];
}

let seq = 0;
function makeId(): string {
  seq += 1;
  return `blk_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function defaultBlockName(index: number): string {
  return `Block ${index + 1}`;
}

/** Structural validation for anything out of storage. */
function isBlock(p: unknown): p is TrainingBlock {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    Array.isArray(o.themes) &&
    o.themes.every((t) => typeof t === "string") &&
    typeof o.themeIndex === "number" &&
    o.themeIndex >= 0 &&
    typeof o.done === "number" &&
    o.done >= 0
    // `credit` is intentionally NOT required: blocks written before the global
    // bar existed have no credit, and sanitizeBlock derives one from their
    // position so their progress still counts toward the bar.
  );
}

function sanitizeBlock(b: TrainingBlock): TrainingBlock {
  const themes = b.themes.filter((t): t is string => typeof t === "string");
  // A position past the end means finished; anything else is clamped in range so
  // a hand-edited/stale value can never render "23 / 8".
  const themeIndex = Math.min(Math.max(0, Math.trunc(b.themeIndex)), themes.length);
  const done = themeIndex >= themes.length ? 0 : Math.max(0, Math.trunc(b.done));
  const rawCredit = b.credit as { themeIndex?: unknown; done?: unknown } | undefined;
  const rawCreditThemeIndex =
    typeof rawCredit?.themeIndex === "number" && Number.isFinite(rawCredit.themeIndex)
      ? Math.max(0, Math.trunc(rawCredit.themeIndex))
      : themeIndex;
  // Credit cannot point past the end of a list that has since shrunk — removing
  // themes must not leave a block claiming rounds it no longer has.
  const creditThemeIndex = Math.min(rawCreditThemeIndex, themes.length);
  const rawCreditDone =
    typeof rawCredit?.done === "number" && Number.isFinite(rawCredit.done)
      ? Math.max(0, Math.trunc(rawCredit.done))
      : done;
  const creditDone = creditThemeIndex >= themes.length ? 0 : rawCreditDone;
  return {
    id: b.id,
    name: b.name.trim() || "Block",
    themes,
    themeIndex,
    done,
    // Credit is never allowed to sit BEHIND the current position: reaching a
    // position earns it, so a stale/absent credit is raised to where the block is.
    credit: {
      themeIndex: Math.max(creditThemeIndex, themeIndex),
      done: creditThemeIndex > themeIndex ? creditDone : Math.max(creditDone, done),
    },
  };
}

/** Rebuild the pre-block world into a single block (read-once migration). */
function migrateFromLegacy(): Stored | null {
  if (typeof window === "undefined") return null;
  let themes: string[] = [];
  try {
    const rawPins = window.localStorage.getItem(LEGACY_PINS_KEY);
    if (rawPins) {
      const parsed = JSON.parse(rawPins);
      if (Array.isArray(parsed)) themes = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* ignore malformed legacy pins */
  }
  let themeIndex = 0;
  let done = 0;
  try {
    const rawRun = window.localStorage.getItem(LEGACY_RUN_KEY);
    if (rawRun) {
      const run = JSON.parse(rawRun) as { themes?: unknown; themeIndex?: unknown; done?: unknown };
      // Adopt the old position only when it still describes a lineup the user
      // has: the run's snapshot must be a PREFIX of the list we are migrating.
      // (Adding pins after starting keeps this true, so a place is never lost
      // needlessly.) If the lineup was replaced entirely — as it was for this
      // user, whose 30 current pins share no order with the old run's 16 — the
      // old numbers would point at different rounds, so the block starts fresh
      // rather than silently pretending to be at a place that no longer exists.
      const runThemes = Array.isArray(run.themes) ? (run.themes as unknown[]) : null;
      const prefixMatches =
        !!runThemes &&
        runThemes.length > 0 &&
        runThemes.length <= themes.length &&
        runThemes.every((t, i) => t === themes[i]);
      if (prefixMatches && typeof run.themeIndex === "number" && typeof run.done === "number") {
        themeIndex = run.themeIndex;
        done = run.done;
      }
    }
  } catch {
    /* ignore malformed legacy run */
  }

  // The legacy keys have been taken over. Remove them so there is exactly ONE
  // source of truth: if they lingered, a device that had not yet synced could
  // re-import stale pins over themes the user has since changed.
  if (themes.length > 0) {
    try {
      window.localStorage.removeItem(LEGACY_PINS_KEY);
      window.localStorage.removeItem(LEGACY_RUN_KEY);
    } catch {
      /* ignore */
    }
  }

  return {
    selected: null,
    blocks: [
      sanitizeBlock({
        id: makeId(),
        // The old run had no name; it becomes Block 1 rather than losing the data.
        name: defaultBlockName(0),
        themes,
        themeIndex,
        done,
        credit: { themeIndex, done },
      }),
    ],
  };
}

/** Read stored blocks, falling back to a migration, then to one empty block. */
function readStored(): { state: Stored; migrated: boolean } {
  const empty = (): Stored => ({
    selected: null,
    blocks: [
      sanitizeBlock({
        id: makeId(),
        name: defaultBlockName(0),
        themes: [],
        themeIndex: 0,
        done: 0,
        credit: { themeIndex: 0, done: 0 },
      }),
    ],
  });
  if (typeof window === "undefined") return { state: empty(), migrated: false };
  try {
    const raw = window.localStorage.getItem(BLOCKS_KEY);
    if (!raw) {
      const legacy = migrateFromLegacy();
      // `migrated` matters: the migration RETIRES the legacy keys, so the result
      // must be written at once. Otherwise the next load finds no keys at all and
      // rebuilds an empty block — the user's themes would be gone for good.
      return legacy ? { state: legacy, migrated: true } : { state: empty(), migrated: false };
    }
    const parsed = JSON.parse(raw) as { blocks?: unknown; selected?: unknown };
    const list = Array.isArray(parsed?.blocks) ? parsed.blocks.filter(isBlock) : [];
    if (list.length === 0) {
      const legacy = migrateFromLegacy();
      return legacy ? { state: legacy, migrated: true } : { state: empty(), migrated: false };
    }
    const blocks = list.slice(0, MAX_BLOCKS).map(sanitizeBlock);
    const selected =
      typeof parsed.selected === "string" && blocks.some((b) => b.id === parsed.selected)
        ? parsed.selected
        : blocks[0].id;
    return { state: { selected, blocks }, migrated: false };
  } catch {
    const legacy = migrateFromLegacy();
    return legacy ? { state: legacy, migrated: true } : { state: empty(), migrated: false };
  }
}

function writeStored(s: Stored): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BLOCKS_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked — the session still works in memory */
  }
}

/** Total puzzles in a block, from the CURRENT global per-theme count. */
export function blockTotal(b: Pick<TrainingBlock, "themes">, perTheme: number): number {
  return b.themes.length * Math.max(1, perTheme);
}

/** 1-based position of the puzzle a block is up to (clamped to its total). */
export function blockPosition(b: TrainingBlock, perTheme: number): number {
  const count = Math.max(1, perTheme);
  const pos = b.themeIndex * count + b.done + 1;
  return Math.min(Math.max(1, pos), Math.max(1, blockTotal(b, count)));
}

/** A block is finished when it has walked past its last theme. */
export function blockComplete(b: Pick<TrainingBlock, "themes" | "themeIndex">): boolean {
  return b.themes.length > 0 && b.themeIndex >= b.themes.length;
}

/**
 * How many puzzles a block has EARNED toward the global bar.
 *
 * `min(furthest reached, what the block currently contains)` — so a block can
 * never contribute more than its own total, and restarting it (which zeroes its
 * position but not its credit) cannot take the credit away. That is what makes
 * "finish a block twice" count once.
 */
export function blockCredit(b: TrainingBlock, perTheme: number): number {
  const count = Math.max(1, perTheme);
  const reached = b.credit.themeIndex * count + b.credit.done;
  return Math.min(Math.max(0, reached), blockTotal(b, count));
}

/** GLOBAL progress across every block — the sum of first-run credits. */
export function globalProgress(
  blocks: TrainingBlock[],
  perTheme: number
): { done: number; total: number } {
  const count = Math.max(1, perTheme);
  let done = 0;
  let total = 0;
  for (const b of blocks) {
    total += blockTotal(b, count);
    done += blockCredit(b, count);
  }
  return { done, total };
}

/**
 * Coerce the stored/typed per-theme count into a valid one.
 *
 * This is the ONE global "puzzles per theme" number, shared by every block. It
 * lives in `puzzle_trainer_settings.quickStartCount` and has been seeded by a
 * test harness before, so it is validated on READ as well as on save — a
 * nonsense value (0, -3, 999, "abc", null) must not render a nonsense total.
 * Unset / non-numeric falls back to 10; anything out of range is clamped 1–100.
 */
export function sanitizeQuickStartCount(v: unknown, fallback = 10): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(n)));
}

export function useTrainingBlocks() {
  const [state, setState] = useState<Stored>({ selected: null, blocks: [] });
  const [loaded, setLoaded] = useState(false);

  // Hydrate AFTER mount: reading localStorage during the first render risks a
  // hydration mismatch, and the sync engine may still be swapping in the
  // server's copy (a device that has never seen this key inherits it).
  useEffect(() => {
    const { state: stored, migrated } = readStored();
    setState(stored);
    // A migration rewrote the world, so it must be persisted right away — see
    // the note in readStored.
    if (migrated) dirtyRef.current = true;
    setLoaded(true);
  }, []);

  // Persist on CHANGE only — never merely because we hydrated.
  //
  // A device opening this app for the first time renders BEFORE the sync engine
  // has pulled the server's copy. Writing the auto-created empty block at that
  // moment would make the blocks key "exist", and the migration that adopts the
  // legacy pins would then never run when they arrive — the user's themes would
  // sit in an unused key while the UI showed an empty block.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    writeStored(state);
  }, [state, loaded]);

  const mutate = useCallback((fn: (b: TrainingBlock[]) => TrainingBlock[]) => {
    dirtyRef.current = true;
    setState((s) => {
      const blocks = fn(s.blocks).slice(0, MAX_BLOCKS).map(sanitizeBlock);
      const selected = s.selected && blocks.some((b) => b.id === s.selected)
        ? s.selected
        : (blocks[0]?.id ?? null);
      return { selected, blocks };
    });
  }, []);

  const withBlock = useCallback(
    (id: string, fn: (b: TrainingBlock) => TrainingBlock) => {
      mutate((blocks) => blocks.map((b) => (b.id === id ? fn(b) : b)));
    },
    [mutate]
  );

  const selected = state.blocks.find((b) => b.id === state.selected) ?? state.blocks[0] ?? null;

  /** Add a block (no-op at the cap). The new block becomes selected. */
  const create = useCallback(
    (name?: string): string | null => {
      let newId: string | null = null;
      setState((s) => {
        if (s.blocks.length >= MAX_BLOCKS) return s;
        dirtyRef.current = true;
        const block = sanitizeBlock({
          id: makeId(),
          name: name?.trim() || defaultBlockName(s.blocks.length),
          themes: [],
          themeIndex: 0,
          done: 0,
          credit: { themeIndex: 0, done: 0 },
        });
        newId = block.id;
        return { selected: block.id, blocks: [...s.blocks, block] };
      });
      return newId;
    },
    []
  );

  const select = useCallback((id: string) => {
    setState((s) => {
      if (!s.blocks.some((b) => b.id === id)) return s;
      dirtyRef.current = true;
      return { ...s, selected: id };
    });
  }, []);

  const rename = useCallback(
    (id: string, name: string) => {
      withBlock(id, (b) => ({ ...b, name: name.trim() || b.name }));
    },
    [withBlock]
  );

  /** Delete a block. Never leaves the list empty (a fresh one takes its place). */
  const remove = useCallback((id: string) => {
    dirtyRef.current = true;
    setState((s) => {
      const blocks = s.blocks.filter((b) => b.id !== id);
      if (blocks.length === 0) {
        const fresh = sanitizeBlock({
          id: makeId(),
          name: defaultBlockName(0),
          themes: [],
          themeIndex: 0,
          done: 0,
          credit: { themeIndex: 0, done: 0 },
        });
        return { selected: fresh.id, blocks: [fresh] };
      }
      const selected = s.selected === id ? blocks[0].id : s.selected;
      return { selected, blocks };
    });
  }, []);

  /** Restart ONE block from round 1. Other blocks are untouched. */
  const restart = useCallback(
    (id: string) => {
      withBlock(id, (b) => ({ ...b, themeIndex: 0, done: 0 }));
    },
    [withBlock]
  );

  const addTheme = useCallback(
    (id: string, themeId: string) => {
      withBlock(id, (b) => ({ ...b, themes: [...b.themes, themeId] }));
    },
    [withBlock]
  );

  const addThemes = useCallback(
    (id: string, themeIds: string[]) => {
      withBlock(id, (b) => {
        const next = [...b.themes];
        for (const t of themeIds) if (!next.includes(t)) next.push(t);
        return { ...b, themes: next };
      });
    },
    [withBlock]
  );

  /**
   * Remove ONE round by position — duplicates mean position matters.
   *
   * Removing a round the user has ALREADY PASSED shifts the position back by one
   * so they stay on the same round instead of silently skipping the next one.
   * The credit banked by sanitizeBlock keeps the earned part of the global bar.
   */
  const removeThemeAt = useCallback(
    (id: string, index: number) => {
      withBlock(id, (b) => {
        const themes = b.themes.filter((_, i) => i !== index);
        const shift = index < b.themeIndex ? 1 : 0;
        return {
          ...b,
          themes,
          themeIndex: Math.min(Math.max(0, b.themeIndex - shift), themes.length),
        };
      });
    },
    [withBlock]
  );

  /** Remove EVERY round of one theme id (the picker's Unpin control). */
  const removeThemeById = useCallback(
    (id: string, themeId: string) => {
      withBlock(id, (b) => {
        const themes = b.themes.filter((t) => t !== themeId);
        // Every removed round that sat BEFORE the current one pulls the position
        // back with it, so the user continues on the same round.
        const removedBefore = b.themes
          .slice(0, Math.min(b.themeIndex, b.themes.length))
          .filter((t) => t === themeId).length;
        return {
          ...b,
          themes,
          themeIndex: Math.min(Math.max(0, b.themeIndex - removedBefore), themes.length),
        };
      });
    },
    [withBlock]
  );

  /** Clear EVERY theme in one block (the picker's "Unpin all"). */
  const clearThemes = useCallback(
    (id: string) => {
      withBlock(id, (b) => ({ ...b, themes: [], themeIndex: 0, done: 0 }));
    },
    [withBlock]
  );

  const reorderThemes = useCallback(
    (id: string, themeIds: string[]) => {
      withBlock(id, (b) => ({ ...b, themes: themeIds.filter((t) => typeof t === "string") }));
    },
    [withBlock]
  );

  const setProgress = useCallback(
    (id: string, next: { themeIndex: number; done: number }) => {
      withBlock(id, (b) => ({ ...b, themeIndex: next.themeIndex, done: next.done }));
    },
    [withBlock]
  );

  return {
    loaded,
    blocks: state.blocks,
    selectedId: selected?.id ?? null,
    selected,
    atCap: state.blocks.length >= MAX_BLOCKS,
    select,
    create,
    rename,
    remove,
    restart,
    addTheme,
    addThemes,
    removeThemeAt,
    removeThemeById,
    clearThemes,
    reorderThemes,
    setProgress,
    BLOCKS_KEY,
    MAX_BLOCKS,
  };
}
