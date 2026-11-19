"use client";

import { useEffect } from "react";

/**
 * Keyboard-shortcuts help overlay.
 *
 * The shortcut definitions are exported as DATA (`SHORTCUTS`) so page.tsx can
 * wire the real key handling. This component deliberately binds NO global key
 * listeners of its own (except Escape to close while open) so it can never
 * fight the app's own handling.
 */

export interface ShortcutDef {
  /** Display key (single key or combo). */
  key: string;
  label: string;
  /** Optional grouping / section. */
  group?: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { key: "h", label: "Hint", group: "Training" },
  { key: "space", label: "Next puzzle", group: "Training" },
  { key: "enter", label: "Submit / advance", group: "Training" },
  { key: "f", label: "Flip board", group: "Board" },
  { key: "s", label: "Show solution", group: "Training" },
  { key: "r", label: "Retry puzzle", group: "Training" },
  { key: "1–9", label: "Jump to move", group: "Board" },
  { key: "z", label: "Toggle zen mode", group: "View" },
  { key: "t", label: "Cycle board theme", group: "View" },
  { key: "m", label: "Toggle sound", group: "View" },
  { key: "?", label: "Toggle this help", group: "Help" },
  { key: "esc", label: "Close / dismiss", group: "Help" },
];

export interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const GROUP_ORDER = ["Training", "Board", "View", "Help"];

export default function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  // Escape closes, but only while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    items: SHORTCUTS.filter((s) => (s.group ?? "Other") === g),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {group}
              </h3>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {s.label}
                    </span>
                    <kbd className="rounded-md border border-gray-300 bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
                      {s.key}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs text-gray-400 dark:text-gray-500">
          Press <kbd className="font-mono">?</kbd> or <kbd className="font-mono">esc</kbd> to close.
        </p>
      </div>
    </div>
  );
}
