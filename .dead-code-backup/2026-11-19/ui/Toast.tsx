"use client";

import type { Toast, ToastTone } from "./useToasts";

/**
 * Toast renderer. Purely presentational — pair with `useToasts()`:
 *
 *   const { toasts, dismiss, push, fireOnce } = useToasts();
 *   <ToastContainer toasts={toasts} onDismiss={dismiss} position="top-right" />
 */

export type ToastPosition =
  | "top-right"
  | "top-center"
  | "bottom-right"
  | "bottom-center";

export interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  position?: ToastPosition;
  className?: string;
}

const TONE_STYLES: Record<ToastTone, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100",
  error:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100",
};

const TONE_ACCENT: Record<ToastTone, string> = {
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

const POSITION_CLASSES: Record<ToastPosition, string> = {
  "top-right": "top-4 right-4 items-end",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
};

export default function ToastContainer({
  toasts,
  onDismiss,
  position = "top-right",
  className = "",
}: ToastContainerProps) {
  return (
    <div
      className={`pointer-events-none fixed z-50 flex w-full max-w-sm flex-col gap-2 ${POSITION_CLASSES[position]} ${className}`}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => {
        const tone: ToastTone = t.tone ?? "info";
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full items-start gap-3 overflow-hidden rounded-lg border px-4 py-3 shadow-lg transition-transform ${TONE_STYLES[tone]}`}
          >
            <span
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${TONE_ACCENT[tone]}`}
            />
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs opacity-80">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="-mr-1 rounded px-1.5 text-lg leading-none opacity-60 transition-opacity hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
