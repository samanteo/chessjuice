"use client";

/**
 * GitHub-style activity heatmap that WRAPS instead of scrolling sideways.
 *
 * Previously this was a 53-column flex row inside an `overflow-x-auto` card, so
 * on a phone it was ~920px wide and you had to scroll horizontally to see most
 * of the year. Now the week columns live in a `flex-wrap` container: they flow
 * onto as many rows as the width allows, so the whole year is visible at once
 * with no horizontal scrolling.
 *
 * Month labels sit in a fixed-height slot above each week column. Every column
 * reserves the same slot height, so labels stay aligned even when the grid
 * wraps across rows.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Local-time YYYY-MM-DD. `toISOString()` is UTC and shifts the day in UTC+7. */
function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Literal class strings so Tailwind can generate them (no dynamic building).
const LEVEL_CLASSES = [
  "bg-[#ebedf0] dark:bg-[#2f2e2b]",
  "bg-[#9be9a8] dark:bg-[#0e4429]",
  "bg-[#40c463] dark:bg-[#006d32]",
  "bg-[#30a14e] dark:bg-[#26a641]",
  "bg-[#216e39] dark:bg-[#39d353]",
];

export function CalendarHeatmap({ data }: { data: Record<string, number> }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const dayOfWeekStart = startOfYear.getDay(); // 0 = Sunday

  const maxCount = Math.max(...Object.values(data), 1);

  const level = (count: number) => {
    if (count <= 0) return 0;
    if (count <= maxCount * 0.25) return 1;
    if (count <= maxCount * 0.5) return 2;
    if (count <= maxCount * 0.75) return 3;
    return 4;
  };

  // Build week columns (each exactly 7 day slots, Sunday → Saturday).
  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = [];
  for (let i = 0; i < dayOfWeekStart; i++) week.push(null);

  const cursor = new Date(startOfYear);
  while (cursor <= today) {
    week.push(new Date(cursor));
    if (cursor.getDay() === 6) {
      weeks.push(week);
      week = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // Which weeks start a new month — used for the label slot above the grid.
  const monthLabelFor = (wk: (Date | null)[]): string | null => {
    const first = wk.find((d): d is Date => d !== null);
    if (!first) return null;
    // Label the week that contains the 1st, or the first week of the month.
    const hasFirst = wk.some((d) => d && d.getDate() === 1);
    if (hasFirst) return MONTHS[first.getMonth()];
    if (first.getDate() <= 7) return MONTHS[first.getMonth()];
    return null;
  };

  const activeDays = Object.values(data).filter((n) => n > 0).length;
  const totalAttempts = Object.values(data).reduce((a, b) => a + b, 0);

  return (
    <div className="font-mono text-xs" data-testid="calendar-heatmap">
      {/* Week columns wrap onto multiple rows — no horizontal scroll. */}
      <div className="flex flex-wrap gap-1">
        {weeks.map((wk, w) => {
          const label = monthLabelFor(wk);
          return (
            <div key={w} className="flex flex-col gap-1">
              {/* Fixed-height month-label slot keeps every column aligned. */}
              <div className="h-3 text-[9px] leading-none text-gray-400 dark:text-gray-500 whitespace-nowrap">
                {label ?? ""}
              </div>
              {wk.map((date, d) => {
                if (!date) {
                  return <div key={`${w}-${d}`} className="h-3.5 w-3.5" />;
                }
                const dateStr = localKey(date);
                const count = data[dateStr] || 0;
                const lv = level(count);
                return (
                  <div
                    key={`${w}-${d}`}
                    className={`h-3.5 w-3.5 rounded-[3px] ${LEVEL_CLASSES[lv]}`}
                    title={`${dateStr}: ${count} puzzle${count === 1 ? "" : "s"}`}
                    aria-label={`${dateStr}: ${count}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend + summary */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">
        <span>
          {activeDays} active day{activeDays === 1 ? "" : "s"} · {totalAttempts} attempt
          {totalAttempts === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1">
          Less
          {LEVEL_CLASSES.map((cls, i) => (
            <span key={i} className={`h-3 w-3 rounded-[2px] ${cls}`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
