"use client";

import { useMemo, useState } from "react";
import { PuzzleAttempt, UserPuzzle } from "@/types";
import {
  groupIntoSessions,
  sessionsNewestFirst,
  resolveAngle,
  angleLabel,
  type HistoryRound,
  type HistorySession,
} from "@/lib/historySessions";

/**
 * Lichess-style puzzle history with a replay queue.
 *
 * Mirrors lila's `PuzzleHistory`: the list is a list of SESSIONS, not rounds.
 * Consecutive rounds fold into one session when they share the same ANGLE (an
 * opening or a theme, else "mix") and are under an hour apart — see
 * src/lib/historySessions.ts for the port and its test.
 *
 * Filters: date range · theme · result · angle (opening). Lichess parity.
 *
 * Replay is PURE PRACTICE (user's decision): attempts made from a replay queue
 * must not touch the SM-2 ladder or the Glicko rating. The caller enforces that;
 * this component only produces id lists.
 *
 * Two instances sit on the Analytics tab: all history, and the last 24h.
 */

export interface PuzzleHistoryProps {
  attempts: PuzzleAttempt[];
  puzzles: UserPuzzle[];
  onReplay: (ids: string[]) => void;
  title: string;
  /** Restrict to attempts newer than this many hours. Omit for all history. */
  windowHours?: number;
  /** Show the date-range filter. Off for the 24h panel (already scoped). */
  showDateRange?: boolean;
  /** How many SESSIONS to render per page (lila pages 100 sessions). */
  sessionsPerPage?: number;
}

type ResultFilter = "all" | "solved" | "failed";
type RangeFilter = "all" | "7" | "30" | "90";

const RANGES: { key: RangeFilter; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
];

const ts = (d: Date | string): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());

function fmtWhen(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtRange(s: HistorySession): string {
  const ms = s.endedAt.getTime() - s.startedAt.getTime();
  if (ms < 60_000) return "under a minute";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function PuzzleHistory({
  attempts,
  puzzles,
  onReplay,
  title,
  windowHours,
  showDateRange = false,
  sessionsPerPage = 100, // lila: MaxPerPage(100)
}: PuzzleHistoryProps) {
  const [result, setResult] = useState<ResultFilter>("all");
  const [theme, setTheme] = useState<string>("all");
  const [angle, setAngle] = useState<string>("all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [page, setPage] = useState(1);

  // puzzleId -> metadata. Server-dispensed puzzles are absent from the local
  // pool, so their metadata rides on the attempt instead.
  const catalogue = useMemo(() => {
    const m = new Map<string, { themes: string[]; rating: number; openings: string[] }>();
    for (const p of puzzles)
      m.set(p.id, { themes: p.themes, rating: p.rating, openings: p.openings ?? [] });
    for (const a of attempts) {
      if (m.has(a.puzzleId)) continue;
      if (a.puzzleRating !== undefined && a.themes) {
        m.set(a.puzzleId, {
          themes: a.themes,
          rating: a.puzzleRating,
          openings: a.openings ?? [],
        });
      }
    }
    return m;
  }, [puzzles, attempts]);

  /** Every attempt in the window, as a round carrying its angle. */
  const rounds = useMemo<HistoryRound[]>(() => {
    const now = Date.now();
    const cutoff = windowHours ? now - windowHours * 3_600_000 : null;
    const out: HistoryRound[] = [];
    for (const a of attempts) {
      const t = ts(a.timestamp);
      if (cutoff !== null && t < cutoff) continue;
      const meta = catalogue.get(a.puzzleId);
      const openings = a.openings ?? meta?.openings ?? [];
      const themes = a.themes ?? meta?.themes ?? [];
      out.push({
        puzzleId: a.puzzleId,
        at: new Date(t),
        // lila records the angle on the round; we use it when present.
        angle: resolveAngle({ angle: a.angle, openings, themes }),
        result: a.result,
        rating: a.puzzleRating ?? meta?.rating ?? null,
        themes,
        openings,
      });
    }
    return out;
  }, [attempts, catalogue, windowHours]);

  const allSessions = useMemo(() => sessionsNewestFirst(groupIntoSessions(rounds)), [rounds]);

  /** Filter options, limited to what actually appears in this history. */
  const themeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rounds) for (const t of r.themes) s.add(t);
    return Array.from(s).sort();
  }, [rounds]);

  /** Only real openings are offered — "mix" is not an opening. */
  const angleOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rounds) if (r.angle !== "mix") s.add(r.angle);
    return Array.from(s).sort();
  }, [rounds]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeCutoff = showDateRange && range !== "all" ? now - Number(range) * 86_400_000 : null;

    return allSessions
      .map((s) => {
        const kept = s.rounds.filter((r) => {
          if (rangeCutoff !== null && r.at.getTime() < rangeCutoff) return false;
          if (theme !== "all" && !r.themes.includes(theme)) return false;
          if (angle !== "all" && r.angle !== angle) return false;
          if (result === "solved" && r.result !== "correct") return false;
          if (result === "failed" && r.result === "correct") return false;
          return true;
        });
        if (kept.length === 0) return null;
        return {
          ...s,
          rounds: kept,
          startedAt: kept[0].at,
          endedAt: kept[kept.length - 1].at,
        } as HistorySession;
      })
      .filter((s): s is HistorySession => s !== null);
  }, [allSessions, theme, angle, result, range, showDateRange]);

  // The queue holds EVERY matching round, newest first — paging never limits it.
  const queue = useMemo(
    () => filtered.flatMap((s) => [...s.rounds].reverse().map((r) => r.puzzleId)),
    [filtered],
  );

  const visible = useMemo(
    () => filtered.slice(0, page * sessionsPerPage),
    [filtered, page, sessionsPerPage],
  );
  const hasMore = filtered.length > visible.length;
  const totalRounds = filtered.reduce((n, s) => n + s.rounds.length, 0);

  const applyResult = (v: ResultFilter) => { setResult(v); setPage(1); };
  const applyTheme = (v: string) => { setTheme(v); setPage(1); };
  const applyAngle = (v: string) => { setAngle(v); setPage(1); };
  const applyRange = (v: RangeFilter) => { setRange(v); setPage(1); };

  const selectCls =
    "appearance-none pl-2.5 pr-7 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-[#262421] " +
    "border border-gray-200 dark:border-white/10 text-gray-700 dark:text-[#e5e0d8] " +
    "hover:border-gray-300 dark:hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-[#bfb060]/50 cursor-pointer max-w-[11rem] truncate";

  const ns = windowHours ? "today" : "all";
  const tid = (name: string) => `history-${ns}-${name}`;

  return (
    <div
      className="rounded-xl bg-white dark:bg-[#262421] border border-gray-200 dark:border-white/5 shadow-sm p-5 min-w-0"
      data-testid={tid("panel")}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-[#e5e0d8]">{title}</h2>
          <p className="text-xs text-gray-500 dark:text-[#8b8987] mt-0.5">
            {filtered.length} session{filtered.length === 1 ? "" : "s"} · {totalRounds} puzzle
            {totalRounds === 1 ? "" : "s"}
          </p>
        </div>
        <button
          data-testid={tid("replay")}
          data-count={queue.length}
          disabled={queue.length === 0}
          onClick={() => onReplay(queue)}
          className={
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors shrink-0 " +
            (queue.length === 0
              ? "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-[#6b6a68] cursor-not-allowed"
              : "bg-[#d59020] text-[#1b1a17] hover:brightness-110")
          }
          title={queue.length === 0 ? "Nothing to replay" : `Replay these ${queue.length} puzzles`}
        >
          <span aria-hidden className="text-[0.7rem]">▶</span>
          Replay {queue.length > 0 ? `all (${queue.length})` : "all"}
        </button>
      </div>

      {/* Filters — date range · theme · result · opening angle (Lichess parity) */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {showDateRange && (
          <select data-testid={tid("range")} value={range} onChange={(e) => applyRange(e.target.value as RangeFilter)} className={selectCls} aria-label="Date range">
            {RANGES.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
          </select>
        )}
        <select data-testid={tid("theme")} value={theme} onChange={(e) => applyTheme(e.target.value)} className={selectCls} aria-label="Theme">
          <option value="all">All themes</option>
          {themeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <select data-testid={tid("result")} value={result} onChange={(e) => applyResult(e.target.value as ResultFilter)} className={selectCls} aria-label="Result">
          <option value="all">Any result</option>
          <option value="solved">Solved</option>
          <option value="failed">Failed</option>
        </select>
        {angleOptions.length > 0 && (
          <select data-testid={tid("angle")} value={angle} onChange={(e) => applyAngle(e.target.value)} className={selectCls} aria-label="Opening">
            <option value="all">All openings</option>
            {angleOptions.map((a) => (<option key={a} value={a}>{angleLabel(a)}</option>))}
          </select>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-[#8b8987] py-6 text-center">
          {allSessions.length === 0
            ? "No puzzles yet. Solve some in the Training tab."
            : "No sessions match these filters."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s, i) => {
            const solved = s.rounds.filter((r) => r.result === "correct").length;
            const pct = Math.round((solved / s.rounds.length) * 100);
            return (
              <li
                key={`${s.angle}-${s.startedAt.getTime()}-${i}`}
                className="rounded-lg border border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02] px-3 py-2"
              >
                {/* Session header: angle + size + window */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-800 dark:text-[#e5e0d8] truncate max-w-[9rem]">
                    {angleLabel(s.angle)}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-[#b9b5ad] tabular-nums">
                    {s.rounds.length}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-[#8b8987] tabular-nums">
                    {pct}% solved
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-[#6b6a68] tabular-nums">
                    {fmtRange(s)}
                  </span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400 dark:text-[#6b6a68]">
                      {fmtWhen(s.endedAt)}
                    </span>
                    <button
                      onClick={() => onReplay([...s.rounds].reverse().map((r) => r.puzzleId))}
                      className="text-[10px] font-semibold text-[#d59020] hover:brightness-110"
                      title={`Replay this session (${s.rounds.length})`}
                    >
                      ▶ Replay
                    </button>
                  </span>
                </div>

                {/* The rounds in this session */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {s.rounds.map((r) => (
                    <button
                      key={`${r.puzzleId}-${r.at.getTime()}`}
                      onClick={() => onReplay([r.puzzleId])}
                      className="flex items-center gap-1 group"
                      title={`${r.puzzleId} · ${r.rating ?? "?"} · replay`}
                    >
                      <span
                        aria-hidden
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          r.result === "correct" ? "bg-[#629924]" : "bg-[#c33]"
                        }`}
                      />
                      <span className="font-mono text-[11px] text-gray-700 dark:text-[#cfcac2] group-hover:text-[#d59020]">
                        {r.puzzleId}
                      </span>
                      {r.rating !== null && (
                        <span className="font-mono text-[10px] text-gray-400 dark:text-[#6b6a68]">
                          {r.rating}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <button
            data-testid={tid("more")}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-[#e5e0d8] hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
          >
            Show {Math.min(sessionsPerPage, filtered.length - visible.length)} more sessions
          </button>
          <p className="text-xs text-gray-400 dark:text-[#6b6a68]">
            showing {visible.length} of {filtered.length} sessions — Replay all uses every match
          </p>
        </div>
      )}
    </div>
  );
}
