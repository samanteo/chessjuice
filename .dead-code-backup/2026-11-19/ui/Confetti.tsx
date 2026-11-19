"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

/**
 * Dependency-free celebratory confetti burst.
 *
 * Two ways to drive it:
 *   <Confetti ref={ref} />            then  ref.current?.fire()
 *   <Confetti active={solved} />      fires on each false -> true transition
 *
 * Draws to a single full-bleed <canvas> overlay, auto-cleans its rAF loop, and
 * removes itself from the pointer path (pointer-events: none).
 */

export interface ConfettiHandle {
  fire: () => void;
}

export interface ConfettiProps {
  /** Optional CSS size/placement classes for the overlay wrapper. */
  className?: string;
  /** Particles released per burst. */
  count?: number;
  /** Burst lifetime in ms (0.6–1.0s recommended). */
  duration?: number;
  /** With `active`, fire on every false -> true transition. */
  active?: boolean;
  /** Called once the burst finishes. */
  onDone?: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  shape: 0 | 1 | 2;
  life: number;
}

const COLORS = [
  "#7fa650",
  "#81b64c",
  "#d9a441",
  "#4a7fb5",
  "#c8544b",
  "#e0b04f",
  "#a3d977",
  "#5f8438",
];

export const Confetti = forwardRef<ConfettiHandle, ConfettiProps>(
  function Confetti(
    { className = "", count = 90, duration = 900, active, onDone },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const particlesRef = useRef<Particle[]>([]);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const parts = particlesRef.current;
      let alive = 0;

      for (const p of parts) {
        if (p.life <= 0) continue;
        p.life -= 1;
        if (p.life <= 0) continue;
        alive++;
        p.vy += 0.32; // gravity
        p.vx *= 0.99; // drag
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 22));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 0) {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.shape === 1) {
          ctx.beginPath();
          ctx.moveTo(0, -p.size / 2);
          ctx.lineTo(p.size / 2, p.size / 2);
          ctx.lineTo(-p.size / 2, p.size / 2);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (alive > 0) {
        rafRef.current = requestAnimationFrame(draw);
      } else {
        rafRef.current = null;
        ctx.clearRect(0, 0, w, h);
        doneRef.current?.();
      }
    }, []);

    const fire = useCallback(() => {
      if (typeof window === "undefined") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;

      // Two fountains from bottom-centre-ish, aimed upward.
      const baseFrames = Math.max(20, Math.round(duration / 16.67));
      const parts: Particle[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.6;
        const speed = 8 + Math.random() * 9;
        parts.push({
          x: w * (0.4 + Math.random() * 0.2),
          y: h * (0.42 + Math.random() * 0.14),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 5 + Math.random() * 7,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          shape: ((Math.random() * 3) | 0) as 0 | 1 | 2,
          life: Math.round(baseFrames * (0.8 + Math.random() * 0.3)),
        });
      }
      particlesRef.current = parts;

      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(draw);
      }
    }, [count, draw, duration]);

    useImperativeHandle(ref, () => ({ fire }), [fire]);

    // Fire on rising edge of `active`.
    const prevActive = useRef(false);
    useEffect(() => {
      if (active && !prevActive.current) fire();
      prevActive.current = !!active;
    }, [active, fire]);

    // Cleanup any in-flight loop on unmount.
    useEffect(() => {
      return () => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
        style={{ width: "100%", height: "100%" }}
      />
    );
  },
);

export default Confetti;
