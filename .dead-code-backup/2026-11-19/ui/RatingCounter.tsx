"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated rating counter.
 *
 * Animates from the previously rendered value to the new `value` over
 * `durationMs` using requestAnimationFrame. Rendered in a `tabular-nums` span
 * so the digit widths are fixed and nothing jitters or shifts layout.
 */

export interface RatingCounterProps {
  value: number;
  /** Animation length in ms. */
  durationMs?: number;
  /** Fixed decimal places. */
  decimals?: number;
  /** Prefix / suffix, e.g. "+" or " ♟". */
  prefix?: string;
  suffix?: string;
  className?: string;
  /** Show a signed delta (e.g. "+12") while animating. */
  showDelta?: boolean;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function RatingCounter({
  value,
  durationMs = 400,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
  showDelta = false,
}: RatingCounterProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    // Respect reduced-motion: snap instantly.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const from = fromRef.current;
    const to = value;
    if (reduce || from === to || durationMs <= 0) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    startRef.current = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / durationMs);
      const eased = easeOutCubic(t);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Whatever we last painted becomes the new baseline for the next change.
      fromRef.current = value;
    };
  }, [value, durationMs]);

  const rounded = Number(display.toFixed(decimals));
  const text = `${prefix}${rounded.toFixed(decimals)}${suffix}`;
  const delta = Math.round(value - fromRef.current);

  return (
    <span
      className={`inline-flex items-baseline tabular-nums ${className}`}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <span>{text}</span>
      {showDelta && delta !== 0 ? (
        <span
          key={`${value}-${delta}`}
          className={`ml-1 text-xs font-semibold ${
            delta > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      ) : null}
    </span>
  );
}
