"use client";

import { useMemo, useState } from "react";
import { usePuzzleStore } from "@/hooks/usePuzzleStore";
import { DashboardView } from "./DashboardView";
import { PuzzleHistory } from "./PuzzleHistory";
import {
  computeDashboard,
  buildAggregateFromAttempts,
  emptyAggregate,
  DashboardAggregate,
  PeriodKey,
  DEFAULT_PERIOD,
} from "./dashboardStats";
import { THEME_META } from "./themeMeta";

/**
 * Prop-less Puzzle Dashboard. Reads the store directly so the parent can render
 * `<AnalyticsPage />` with no wiring. Matches Lichess's /training/dashboard.
 *
 * Below the dashboard sit two Lichess-style history panels side by side:
 *   - Puzzle history   (everything, with date-range / theme / result filters)
 *   - Today            (last 24h, same filters minus the date range)
 * Each has a Replay-all button that queues the filtered set on the board.
 * Replay is PURE PRACTICE — it does not touch the SM-2 ladder or the rating.
 */
export interface AnalyticsPageProps {
  onReplay?: (ids: string[]) => void;
}

export default function AnalyticsPage({ onReplay }: AnalyticsPageProps) {
  const { puzzles, attempts, dashboardAggregate, isLoading } = usePuzzleStore();
  const [period, setPeriod] = useState<PeriodKey>(DEFAULT_PERIOD);

  // Prefer the persisted per-day rollup (never truncates). Fall back to
  // deriving it from the attempts buffer if it is not populated yet.
  const agg: DashboardAggregate = useMemo(() => {
    if (dashboardAggregate && dashboardAggregate.overall && dashboardAggregate.overall.nb > 0) {
      return dashboardAggregate;
    }
    if (attempts.length > 0 && puzzles.length > 0) {
      return buildAggregateFromAttempts(attempts, puzzles);
    }
    return dashboardAggregate || emptyAggregate();
  }, [dashboardAggregate, attempts, puzzles]);

  const dashboard = useMemo(
    () => computeDashboard(period, attempts, puzzles, agg, THEME_META),
    [period, attempts, puzzles, agg]
  );

  const noop = useMemo(() => () => {}, []);

  if (isLoading && puzzles.length === 0) {
    return (
      <div className="space-y-6" data-testid="dashboard-loading">
        <div className="h-8 w-64 rounded bg-gray-200 dark:bg-white/10 animate-pulse" />
        <div className="h-72 rounded-xl bg-gray-100 dark:bg-[#262421] animate-pulse flex items-center justify-center">
          <span className="text-sm text-gray-500 dark:text-[#8b8987]">
            Loading puzzles… the full catalogue takes a few seconds to load.
          </span>
        </div>
      </div>
    );
  }

  return (
    <DashboardView
      dashboard={dashboard}
      themeMeta={THEME_META}
      period={period}
      onPeriodChange={setPeriod}
    >
      {/* ---- Puzzle history: all time, beside today's 24h history ----
          Rendered via the DashboardView `children` slot so it sits directly
          under the metrics/radar card (where the old replay control was)
          rather than ~1.4 screens further down the page. */}
      <div className="grid gap-6 lg:grid-cols-2" data-testid="history-panels">
        <PuzzleHistory
          title="Puzzle history"
          attempts={attempts}
          puzzles={puzzles}
          onReplay={onReplay ?? noop}
          showDateRange
        />
        <PuzzleHistory
          title="Today"
          attempts={attempts}
          puzzles={puzzles}
          onReplay={onReplay ?? noop}
          windowHours={24}
        />
      </div>
    </DashboardView>
  );
}
