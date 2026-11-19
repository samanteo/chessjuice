"use client";

import { PuzzleAttempt } from "@/types";

export function RatingProgressChart({ data }: { data: PuzzleAttempt[] }) {
  // Group by day
  const dailyRating: Record<string, { rating: number; count: number }> = {};
  data.forEach(a => {
    const date = new Date(a.timestamp).toISOString().split('T')[0];
    if (!dailyRating[date]) dailyRating[date] = { rating: a.ratingAfter, count: 0 };
    dailyRating[date].count++;
  });

  const sortedDates = Object.keys(dailyRating).sort();
  if (sortedDates.length === 0) {
    return <div className="h-full flex items-center justify-center text-gray-500 text-xs">No data yet</div>;
  }

  const ratings = sortedDates.map(d => dailyRating[d].rating);
  const minRating = Math.min(...ratings) - 50;
  const maxRating = Math.max(...ratings) + 50;

  // Guard against a single data point (len-1 === 0) so we never emit NaN coords.
  const denom = Math.max(sortedDates.length - 1, 1);
  const xFor = (i: number) => (i / denom) * 380 + 10;
  const yFor = (i: number) => 190 - ((ratings[i] - minRating) / (maxRating - minRating)) * 170;

  const pathData = sortedDates.map((_, i) => {
    return `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(i)}`;
  }).join(' ');

  return (
    <div className="w-full h-full">
      <svg viewBox="0 0 400 200" preserveAspectRatio="none" className="w-full h-full">
        <defs>
          <linearGradient id="ratingGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="400" height="200" fill="transparent" />
        <path
          d={pathData}
          stroke="#3b82f6"
          strokeWidth="2"
          fill="none"
        />
        <path
          d={pathData + " L 390 200 L 10 200 Z"}
          fill="url(#ratingGradient)"
        />
        {/* Y-axis labels */}
        <text x="5" y="20" fontSize="10" fill="gray" textAnchor="start">{maxRating}</text>
        <text x="5" y="195" fontSize="10" fill="gray" textAnchor="start">{minRating}</text>
        {sortedDates.map((_, i) => (
          <circle
            key={i}
            cx={xFor(i)}
            cy={yFor(i)}
            r="3"
            fill="#3b82f6"
          />
        ))}
      </svg>
    </div>
  );
}