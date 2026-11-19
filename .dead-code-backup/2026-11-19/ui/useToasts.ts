"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal toast system for milestones ("7-day streak!", "12 solved today").
 *
 *   const { toasts, push, dismiss, fireOnce } = useToasts();
 *   push({ title: "Nice!", description: "Puzzle solved", tone: "success" });
 *   fireOnce("streak-7-2026-11-19", { title: "7-day streak!" });
 *
 * `fireOnce` persists fired milestone keys in sessionStorage (falling back to an
 * in-memory Set) so the same milestone never fires twice in a session.
 * Render <ToastContainer toasts={toasts} onDismiss={dismiss} />.
 */

export type ToastTone = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-expiry; 0 = sticky. Default 4500. */
  duration?: number;
}

export type ToastInput = Omit<Toast, "id"> & { id?: string };

export interface UseToasts {
  toasts: Toast[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
  /**
   * Fire a toast at most once per `key` for the lifetime of the session.
   * Returns true if it actually fired.
   */
  fireOnce: (key: string, toast: ToastInput) => boolean;
  /** Manually mark a milestone key seen without firing. */
  markSeen: (key: string) => void;
}

const SEEN_KEY = "toasts.seenMilestones";

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

let uid = 0;
function nextId(): string {
  uid += 1;
  return `toast-${Date.now().toString(36)}-${uid}`;
}

export function useToasts(): UseToasts {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Hydrate the "already seen" set once on the client.
  useEffect(() => {
    seenRef.current = loadSeen();
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: ToastInput): string => {
      const id = toast.id ?? nextId();
      const item: Toast = { ...toast, id };
      setToasts((prev) => [...prev.filter((t) => t.id !== id), item]);

      const duration = toast.duration ?? 4500;
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const markSeen = useCallback((key: string) => {
    seenRef.current.add(key);
    saveSeen(seenRef.current);
  }, []);

  const fireOnce = useCallback(
    (key: string, toast: ToastInput): boolean => {
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      saveSeen(seenRef.current);
      push(toast);
      return true;
    },
    [push],
  );

  // Clean up pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return { toasts, push, dismiss, clear, fireOnce, markSeen };
}

export default useToasts;
