"use client";

import { useRef, useState } from "react";
import Confetti, { type ConfettiHandle } from "@/ui/Confetti";
import RatingCounter from "@/ui/RatingCounter";
import { BoardSkeleton, CatalogSkeleton, Skeleton } from "@/ui/Skeleton";
import ShortcutsHelp, { SHORTCUTS } from "@/ui/ShortcutsHelp";
import ThemeIcon, { THEME_ICON_IDS } from "@/ui/ThemeIcon";
import ToastContainer from "@/ui/Toast";
import { useToasts } from "@/ui/useToasts";
import { SOUND_KINDS, type SoundKind, useSounds } from "@/ui/sounds";

/** The themes the app actually uses, in presentation order. */
const FEATURED_THEMES: string[] = [
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "hangingPiece",
  "trappedPiece",
  "sacrifice",
  "promotion",
  "underPromotion",
  "enPassant",
  "castling",
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "backRankMate",
  "smotheredMate",
  "arabianMate",
  "opening",
  "middlegame",
  "endgame",
  "rookEndgame",
  "bishopEndgame",
  "knightEndgame",
  "pawnEndgame",
  "queenEndgame",
  "master",
  "masterVsMaster",
  "kingsideAttack",
  "queensideAttack",
  "quietMove",
  "zugzwang",
  "deflection",
  "clearance",
  "interference",
  "xRayAttack",
  "intermezzo",
  "attackingF2F7",
  "capturingDefender",
  "exposedKing",
  "advancedPawn",
  "equality",
  "advantage",
  "crushing",
];

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
        {title}
      </h2>
      {subtitle ? (
        <p className="mb-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
          {subtitle}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

export default function DevPreviewPage() {
  const sounds = useSounds();
  const confettiRef = useRef<ConfettiHandle>(null);
  const { toasts, push, dismiss, fireOnce, clear } = useToasts();

  const [rating, setRating] = useState(1450);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [lastSound, setLastSound] = useState<SoundKind | null>(null);

  const play = (kind: SoundKind) => {
    setLastSound(kind);
    sounds.play(kind);
  };

  return (
    <main className="relative mx-auto max-w-6xl space-y-8 px-4 py-10 pb-32">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            UI primitives — /dev-preview
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Standalone components for MATE MEMORY. Tailwind only, no new deps,
            light + dark.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            dark mode:
          </span>
          <button
            type="button"
            onClick={() =>
              document.documentElement.classList.toggle("dark")
            }
            className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            toggle
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Sounds */}
        <Section
          title="Sound engine"
          subtitle="WebAudio oscillator blips — no assets. Autoplay-policy safe."
        >
          <div className="flex flex-wrap items-center gap-2">
            {SOUND_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => play(kind)}
                className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                ▶ {kind}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={!sounds.muted}
                onChange={() => sounds.toggle()}
                className="h-4 w-4"
              />
              sound on
            </label>
          </div>
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            last: {lastSound ?? "—"} · muted: {String(sounds.muted)}
          </p>
        </Section>

        {/* Confetti */}
        <Section
          title="Confetti"
          subtitle="Dependency-free canvas burst (~0.9s), auto-cleans its frame loop."
        >
          <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
            <Confetti ref={confettiRef} />
            <button
              type="button"
              onClick={() => confettiRef.current?.fire()}
              className="relative z-10 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
            >
              🎉 Fire confetti
            </button>
          </div>
        </Section>

        {/* Rating counter */}
        <Section
          title="Animated rating counter"
          subtitle="Counts up/down over 400ms with tabular-nums — no jitter or shift."
        >
          <div className="flex items-center gap-4">
            <span className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              <RatingCounter value={rating} showDelta />
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRating((r) => r - 12)}
                className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                −12
              </button>
              <button
                type="button"
                onClick={() => setRating((r) => r + 12)}
                className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                +12
              </button>
              <button
                type="button"
                onClick={() => setRating((r) => r + 137)}
                className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                +137
              </button>
            </div>
          </div>
        </Section>

        {/* Toasts */}
        <Section
          title="Toasts"
          subtitle="Auto-expiring, dismissible; fireOnce() de-dupes milestones."
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                push({ title: "Puzzle solved", description: "+12 rating", tone: "success" })
              }
              className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              info toast
            </button>
            <button
              type="button"
              onClick={() =>
                fireOnce("streak-7", {
                  title: "7-day streak! 🔥",
                  description: "Keep it up — don't break the chain.",
                  tone: "success",
                })
              }
              className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              fireOnce milestone
            </button>
            <button
              type="button"
              onClick={() => clear()}
              className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              clear
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            "fireOnce milestone" only fires the first time per session — press it
            again and nothing happens.
          </p>
        </Section>
      </div>

      {/* Theme icons */}
      <Section
        title="Theme icons"
        subtitle={`${THEME_ICON_IDS.length} monochrome glyphs + aliases + fallback. Inherit currentColor; one stroke family.`}
      >
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {FEATURED_THEMES.map((id) => (
            <div
              key={id}
              className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
              title={id}
            >
              <ThemeIcon theme={id} size={26} className="text-gray-700 dark:text-gray-200" />
              <span className="w-full truncate text-center text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                {id}
              </span>
            </div>
          ))}
          {/* fallback proof */}
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
            <ThemeIcon theme="not-a-real-theme" size={26} className="text-gray-400" />
            <span className="text-center text-[10px] leading-tight text-gray-400">
              fallback
            </span>
          </div>
        </div>
      </Section>

      {/* Skeletons */}
      <Section
        title="Skeletons"
        subtitle="Board-shaped shimmer + generic blocks for the ~10s catalog load."
      >
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div>
            <BoardSkeleton size={320} className="mx-auto" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-3 pt-2">
              <Skeleton className="h-10 w-28 rounded-lg" />
              <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
            <p className="pt-4 text-sm text-gray-500 dark:text-gray-400">
              Full catalog skeleton ↓
            </p>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-200 pt-8 dark:border-gray-700">
          <CatalogSkeleton label="Loading 12,000 puzzles…" />
        </div>
      </Section>

      {/* Shortcuts */}
      <Section
        title="Shortcuts help"
        subtitle="Overlay + exported SHORTCUTS data. Binds no global keys (only Esc while open)."
      >
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Open shortcuts overlay
        </button>
        <div className="mt-5">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            exported data ({SHORTCUTS.length} entries)
          </p>
          <div className="flex flex-wrap gap-2">
            {SHORTCUTS.map((s) => (
              <span
                key={s.key}
                className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300"
              >
                <kbd className="font-mono font-semibold">{s.key}</kbd>{" "}
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ToastContainer toasts={toasts} onDismiss={dismiss} position="bottom-right" />
    </main>
  );
}
