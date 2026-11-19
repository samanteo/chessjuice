"use client";

import { useMemo, useState } from "react";
import { PuzzleAttempt, UserPuzzle } from "@/types";
import { DashboardView } from "./DashboardView";
import {
  computeDashboard,
  buildAggregateFromAttempts,
  PeriodKey,
  DEFAULT_PERIOD,
} from "./dashboardStats";
import { ThemeMeta } from "./themeMeta";

// ---------------------------------------------------------------------------
// Legacy prop-driven dashboard. Still rendered by the old page.tsx wiring while
// the parent migrates to the prop-less <AnalyticsPage />. Keeps the same props
// so nothing breaks, but delegates all maths + rendering to the new modules.
// The persisted rollup lives in the store, so here we rebuild it from the
// timestamped attempts buffer (the props we are given).
// ---------------------------------------------------------------------------
interface PuzzleDashboardProps {
  attempts: PuzzleAttempt[];
  puzzles: UserPuzzle[];
  settings: unknown;
  aggregates?: unknown;
  replayCount?: number;
  themeMeta: Record<string, ThemeMeta>;
}

export function PuzzleDashboard({ attempts, puzzles, themeMeta }: PuzzleDashboardProps) {
  const [period, setPeriod] = useState<PeriodKey>(DEFAULT_PERIOD);

  const agg = useMemo(() => buildAggregateFromAttempts(attempts, puzzles), [attempts, puzzles]);
  const dashboard = useMemo(
    () => computeDashboard(period, attempts, puzzles, agg, themeMeta),
    [period, attempts, puzzles, agg, themeMeta]
  );

  return (
    <DashboardView
      dashboard={dashboard}
      themeMeta={themeMeta}
      period={period}
      onPeriodChange={setPeriod}
    />
  );
}
