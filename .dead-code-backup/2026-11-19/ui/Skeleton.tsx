"use client";

/**
 * Skeleton placeholders.
 *
 * - `Skeleton`         generic shimmering block (pass a size via className).
 * - `BoardSkeleton`    board-shaped 8x8 placeholder for the catalog load.
 * - `CatalogSkeleton`  board + side-panel text lines + "loading N puzzles".
 *
 * Uses Tailwind's built-in `animate-pulse` (no config changes required).
 */

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-gray-200/80 dark:bg-gray-700/60 ${className}`}
    />
  );
}

export interface BoardSkeletonProps {
  /** Rendered board size; square. */
  size?: number;
  className?: string;
}

/**
 * A board-shaped skeleton: an 8x8 checker of squares with a soft shimmer and a
 * pulsing centre badge. Sized to match the real board so there is no layout
 * shift when the catalog arrives.
 */
export function BoardSkeleton({ size = 480, className = "" }: BoardSkeletonProps) {
  const squares = Array.from({ length: 64 });
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{ width: size, height: size, maxWidth: "100%" }}
    >
      <div className="grid h-full w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-md">
        {squares.map((_, i) => {
          const row = Math.floor(i / 8);
          const col = i % 8;
          const dark = (row + col) % 2 === 1;
          return (
            <div
              key={i}
              className={
                dark
                  ? "bg-gray-300/70 dark:bg-gray-600/50"
                  : "bg-gray-200/80 dark:bg-gray-700/40"
              }
            />
          );
        })}
      </div>

      {/* Soft sweeping shimmer overlay. */}
      <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-br from-white/0 via-white/40 to-white/0 dark:via-white/10" />

      {/* Centre badge. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          Loading…
        </div>
      </div>
    </div>
  );
}

export interface CatalogSkeletonProps {
  /** Number of text placeholder rows in the side panel. */
  rows?: number;
  /** Progress message, e.g. "Loading 12,000 puzzles…". */
  label?: string;
  className?: string;
}

/** Full training-view skeleton: board on the left, panel lines on the right. */
export function CatalogSkeleton({
  rows = 5,
  label = "Loading puzzles…",
  className = "",
}: CatalogSkeletonProps) {
  return (
    <div
      className={`flex flex-col items-start gap-8 lg:flex-row ${className}`}
    >
      <div className="relative">
        <BoardSkeleton size={480} />
      </div>

      <div className="w-full max-w-sm space-y-4 pt-2">
        <Skeleton className="h-7 w-40" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <div className="space-y-3 pt-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 pt-4">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default Skeleton;
