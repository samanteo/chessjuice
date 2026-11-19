"use client";

import { useMemo } from "react";

export interface RadarAxis {
  key: string;
  label: string;
  value: number;
}

interface ThemeRadarChartProps {
  data: RadarAxis[];
  /** Rendered pixel size of the square chart area (the SVG scales). */
  size?: number;
}

// Lichess palette for the radar: muted olive-yellow polygon on a dark card.
const OLIVE = "#bfb060";
const OLIVE_FILL = "rgba(191, 176, 96, 0.22)";
const GRID = "currentColor";

/**
 * Dependency-free radar / spider chart.
 * Each axis' vertex radius is proportional to that theme's performance
 * relative to the strongest theme currently shown.
 */
export function ThemeRadarChart({ data, size = 420 }: ThemeRadarChartProps) {
  const axes = data.length;

  // Padding (in viewBox units) reserved OUTSIDE the chart square for the
  // perimeter axis labels. Without it the labels are clipped at the SVG edge,
  // which rendered "Deflection" as "D" and "Endgame" as "Endg".
  const PAD = Math.round(size * 0.26);

  const { cx, cy, R, outerR } = useMemo(() => {
    const cx = size / 2;
    const cy = size / 2;
    // Leave headroom for the perimeter labels.
    const outerR = size / 2;
    const R = size / 2 - Math.max(46, size * 0.14);
    return { cx, cy, R, outerR };
  }, [size]);

  if (axes < 3) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Not enough theme data yet for a radar chart.
      </div>
    );
  }

  const angleFor = (i: number) => (-Math.PI / 2) + (i * 2 * Math.PI) / axes;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Keep a small floor so very weak themes still show a visible vertex.
  const valueRadius = (v: number) => Math.max(0.06 * R, (Math.max(v, 0) / maxValue) * R);

  const pointAt = (i: number, r: number) => {
    const a = angleFor(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };

  // Concentric polygon gridlines (4 rings + outline).
  const rings = [0.25, 0.5, 0.75, 1];

  const dataPoints = data.map((d, i) => pointAt(i, valueRadius(d.value)));
  const dataPolygon = dataPoints.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  return (
    <div className="w-full flex justify-center" data-testid="theme-radar">
      <svg
        viewBox={`${-PAD} ${-PAD} ${size + PAD * 2} ${size + PAD * 2}`}
        width="100%"
        style={{ maxWidth: size + PAD * 2 }}
        role="img"
        aria-label="Theme performance radar chart"
        className="text-gray-300 dark:text-white/15"
      >
        {/* concentric gridlines */}
        {rings.map((ring) => {
          const pts = Array.from({ length: axes }, (_, i) => pointAt(i, R * ring));
          return (
            <polygon
              key={ring}
              points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
              fill="none"
              stroke={GRID}
              strokeWidth={1}
            />
          );
        })}

        {/* axis spokes */}
        {Array.from({ length: axes }, (_, i) => {
          const [x, y] = pointAt(i, R);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={GRID} strokeWidth={1} />;
        })}

        {/* data polygon */}
        <polygon points={dataPolygon} fill={OLIVE_FILL} stroke={OLIVE} strokeWidth={2} strokeLinejoin="round" />

        {/* vertices */}
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={OLIVE} />
        ))}

        {/* axis labels */}
        {data.map((d, i) => {
          const a = angleFor(i);
          const lx = cx + outerR * 0.96 * Math.cos(a);
          const ly = cy + outerR * 0.96 * Math.sin(a);
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
          // Nudge labels toward the edge vertically so they don't collide.
          const dy = sin < -0.3 ? "-0.2em" : sin > 0.3 ? "0.9em" : "0.32em";
          return (
            <text
              key={d.key}
              x={lx}
              y={ly}
              dy={dy}
              textAnchor={anchor}
              className="fill-gray-600 dark:fill-gray-300"
              style={{ fontSize: size * 0.036, fontWeight: 500 }}
            >
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
