"use client";

import { useMemo } from "react";
import { ThemeRadarChart, RadarAxis } from "./ThemeRadarChart";
import {
  Dashboard,
  PeriodKey,
  PERIODS,
  ThemeStat,
  pickRadarThemes,
  rankedThemes,
} from "./dashboardStats";
import { ThemeMeta } from "./themeMeta";

// Lichess palette.
const PAGE_BG = "#161512";
const CARD_BG = "#262421";
const TEXT = "#e5e0d8";
const MUTED = "#8b8987";

export interface DashboardViewProps {
  dashboard: Dashboard;
  themeMeta: Record<string, ThemeMeta>;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  /**
   * Rendered immediately after the global card (metrics + radar) and BEFORE the
   * improvement/strength sections. The puzzle-history panels go here so they sit
   * where the old replay control was, instead of ~1.4 screens further down.
   */
  children?: React.ReactNode;
}

export function DashboardView({
  dashboard,
  themeMeta,
  period,
  onPeriodChange,
  children,
}: DashboardViewProps) {
  const { global, stats } = dashboard;

  const radarData: RadarAxis[] = useMemo(
    () =>
      pickRadarThemes(stats).map((s) => ({
        key: s.theme,
        label: s.label,
        value: s.performance,
      })),
    [stats]
  );

  const { weak, strong } = useMemo(() => rankedThemes(stats, global), [stats, global]);

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? `${dashboard.days} days`;

  return (
    <div className="space-y-6 dark:text-[#e5e0d8]" data-source={dashboard.source}>
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-[#e5e0d8]">Puzzle Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-[#8b8987] mt-0.5">Train, analyse, improve</p>
        </div>

        <label className="relative inline-flex items-center">
          <span className="sr-only">Period</span>
          <select
            data-testid="period-select"
            value={period}
            onChange={(e) => onPeriodChange(e.target.value as PeriodKey)}
            className="appearance-none pl-3 pr-9 py-2 rounded-lg text-sm font-medium bg-white dark:bg-[#262421] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-[#e5e0d8] hover:border-gray-300 dark:hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-[#bfb060]/50 cursor-pointer"
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 text-gray-400 dark:text-[#8b8987] text-xs">▾</span>
        </label>
      </div>

      {/* ---- Global card: metrics + radar + replay ---- */}
      <div className="rounded-xl bg-white dark:bg-[#262421] border border-gray-200 dark:border-white/5 shadow-sm p-6">
        <MetricRow
          testPrefix="overall"
          performance={global.performance}
          unclear={global.unclear}
          played={global.nb}
          solved={global.winPercent}
        />

        <div className="mt-6">
          {radarData.length > 2 ? (
            <ThemeRadarChart data={radarData} />
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center text-gray-500 dark:text-[#8b8987]">
              <div className="text-4xl mb-2">🕸️</div>
              <p className="text-sm font-medium">Not enough data yet</p>
              <p className="text-xs mt-1 max-w-xs">
                Solve a few puzzles in at least 3 themes ({periodLabel.toLowerCase()}) and your radar will fill in.
              </p>
            </div>
          )}
        </div>

        {/* Replay link REMOVED — the puzzle-history panels render here instead. */}
      </div>

      {children}

      {global.nb === 0 && stats.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-[#262421] border border-gray-200 dark:border-white/5 p-8 text-center text-gray-500 dark:text-[#8b8987]">
          <p className="text-sm">
            No attempts recorded in the last {dashboard.days} days. Solve puzzles in the Training tab and your
            dashboard will light up.
          </p>
        </div>
      ) : (
        <>
          {weak.length > 0 && (
            <ThemeSection
              testId="improvement-section"
              heading="Improvement areas"
              subtitle="Train these to optimise your progress!"
              themes={weak}
              themeMeta={themeMeta}
              accent="weak"
            />
          )}

          {strong.length > 0 && (
            <ThemeSection
              testId="strengths-section"
              heading="Strengths"
              subtitle="Keep your strengths sharp!"
              themes={strong}
              themeMeta={themeMeta}
              accent="strong"
            />
          )}
        </>
      )}
    </div>
  );
}

function ThemeSection({
  testId,
  heading,
  subtitle,
  themes,
  themeMeta,
  accent,
}: {
  testId: string;
  heading: string;
  subtitle: string;
  themes: ThemeStat[];
  themeMeta: Record<string, ThemeMeta>;
  accent: "weak" | "strong";
}) {
  return (
    <section data-testid={testId} className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-[#e5e0d8]">{heading}</h2>
        <p className="text-sm text-gray-500 dark:text-[#8b8987]">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {themes.map((t) => (
          <ThemeStatCard
            key={t.theme}
            stat={t}
            description={themeMeta[t.theme]?.description ?? t.description}
            accent={accent}
          />
        ))}
      </div>
    </section>
  );
}

function ThemeStatCard({
  stat,
  description,
  accent,
}: {
  stat: ThemeStat;
  description?: string;
  accent: "weak" | "strong";
}) {
  const accentBar =
    accent === "strong" ? "bg-green-500 dark:bg-[#7fa650]" : "bg-amber-500 dark:bg-[#d59020]";

  return (
    <div
      data-testid="theme-card"
      data-theme={stat.theme}
      data-nb={stat.nb}
      data-wins={stat.wins}
      data-fixed={stat.fixed}
      data-firstwins={stat.firstWins}
      data-failed={stat.failed}
      data-avg-rating={stat.puzzleRatingAvg}
      data-performance={stat.performance}
      data-win-percent={stat.winPercent}
      className="relative rounded-xl bg-white dark:bg-[#262421] border border-gray-200 dark:border-white/5 shadow-sm p-5 pl-6 overflow-hidden"
    >
      <span className={`absolute left-0 top-0 h-full w-1.5 ${accentBar}`} aria-hidden />
      <h3 className="font-bold text-gray-900 dark:text-[#e5e0d8] mb-1">{stat.label}</h3>
      {description ? (
        <p className="text-sm text-gray-600 dark:text-[#8b8987] leading-snug mb-4">{description}</p>
      ) : (
        <div className="mb-4" />
      )}
      <MetricRow
        testPrefix={`theme-${stat.theme}`}
        performance={stat.performance}
        unclear={stat.unclear}
        played={stat.nb}
        solved={stat.winPercent}
        compact
      />
    </div>
  );
}

function MetricRow({
  testPrefix,
  performance,
  unclear,
  played,
  solved,
  compact = false,
}: {
  testPrefix: string;
  performance: number;
  unclear?: boolean;
  played: number;
  solved: number;
  compact?: boolean;
}) {
  const cells: { key: string; label: string; value: string; note?: string }[] = [
    { key: "performance", label: "Performance", value: String(performance), note: unclear ? "?" : undefined },
    { key: "played", label: "Played", value: String(played) },
    { key: "solved", label: "Solved", value: `${solved}%` },
  ];
  return (
    <div className={`grid grid-cols-3 ${compact ? "gap-2" : "gap-4"}`}>
      {cells.map((c) => (
        <div key={c.key} className="text-center min-w-0" data-testid={`${testPrefix}-${c.key}`}>
          <div
            className={`font-semibold text-gray-500 dark:text-[#8b8987] truncate ${
              // "PERFORMANCE" at text-xs + tracking-wide needs 95px, but a 3-up grid
              // on a 390px phone gives each cell only ~81px. Drop a step on mobile so
              // the label fits rather than overflowing its cell.
              compact ? "text-xs" : "text-[10px] uppercase tracking-wide"
            }`}
          >
            {c.label}
          </div>
          <div className={`font-bold text-gray-900 dark:text-[#e5e0d8] ${compact ? "text-lg" : "text-2xl"}`}>
            {c.value}
            {c.note && (
              <span
                className="ml-0.5 text-amber-500 dark:text-[#bfb060]"
                title="Statistically unclear: not enough rounds yet"
              >
                {c.note}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
