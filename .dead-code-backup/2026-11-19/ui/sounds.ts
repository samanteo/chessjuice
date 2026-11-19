"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Tiny dependency-free WebAudio sound engine for MATE MEMORY.
 *
 * - Zero audio assets: every cue is synthesised from oscillators + gain envelopes.
 * - Safe on the server (guards `typeof window`).
 * - Respects the browser autoplay policy by lazily creating / resuming the
 *   AudioContext on the first user gesture it observes.
 * - Mute preference persisted in localStorage under `sounds.muted`.
 *
 * Usage (non-React):
 *   import { playSound, setMuted, isMuted } from "@/ui/sounds";
 *   playSound("solved");
 *
 * Usage (React):
 *   const { play, muted, toggle } = useSounds();
 *   play("capture");
 */

export type SoundKind = "move" | "capture" | "check" | "solved" | "wrong";

export const SOUND_KINDS: SoundKind[] = [
  "move",
  "capture",
  "check",
  "solved",
  "wrong",
];

const STORAGE_KEY = "sounds.muted";

let ctx: AudioContext | null = null;
let muted = false;
let preferenceLoaded = false;
let unlockBound = false;

/* --------------------------------------------------------------------------
 * Preference (localStorage) — safe on the server
 * ------------------------------------------------------------------------ */
function loadPreference(): void {
  if (preferenceLoaded || typeof window === "undefined") return;
  preferenceLoaded = true;
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    /* storage disabled — default to unmuted */
  }
}

export function isMuted(): boolean {
  loadPreference();
  return muted;
}

export function setMuted(next: boolean): void {
  loadPreference();
  muted = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

export function toggleMuted(): boolean {
  setMuted(!isMuted());
  return muted;
}

/* --------------------------------------------------------------------------
 * AudioContext lifecycle
 * ------------------------------------------------------------------------ */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

function resumeContext(): void {
  const c = getContext();
  if (c && c.state === "suspended") {
    // Fire-and-forget; browsers resolve this once a gesture has occurred.
    void c.resume().catch(() => {});
  }
}

/** Bind a one-shot gesture listener that unlocks audio on first interaction. */
export function unlockAudio(): void {
  if (typeof window === "undefined" || unlockBound) return;
  unlockBound = true;
  const handler = () => {
    resumeContext();
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("touchstart", handler);
  };
  window.addEventListener("pointerdown", handler, { passive: true });
  window.addEventListener("keydown", handler);
  window.addEventListener("touchstart", handler, { passive: true });
}

/* --------------------------------------------------------------------------
 * Voice synthesis helpers
 * ------------------------------------------------------------------------ */
interface ToneOptions {
  freq: number;
  /** seconds */
  duration: number;
  type?: OscillatorType;
  /** seconds, relative to "now" */
  delay?: number;
  gain?: number;
  /** glide to this frequency over the duration */
  slideTo?: number;
}

function tone(o: ToneOptions): void {
  const c = getContext();
  if (!c) return;
  const start = c.currentTime + (o.delay ?? 0);
  const end = start + o.duration;

  const osc = c.createOscillator();
  const amp = c.createGain();

  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, start);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, end);

  const peak = o.gain ?? 0.18;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(amp).connect(c.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

function noiseBurst(duration: number, gain = 0.12, delay = 0): void {
  const c = getContext();
  if (!c) return;
  const start = c.currentTime + delay;
  const frames = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const amp = c.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(amp).connect(c.destination);
  src.start(start);
  src.stop(start + duration + 0.02);
}

/* --------------------------------------------------------------------------
 * The five cues
 * ------------------------------------------------------------------------ */
function render(kind: SoundKind): void {
  switch (kind) {
    case "move": {
      tone({ freq: 320, duration: 0.07, type: "triangle", gain: 0.14 });
      break;
    }
    case "capture": {
      noiseBurst(0.09, 0.16);
      tone({ freq: 180, duration: 0.09, type: "square", gain: 0.12 });
      break;
    }
    case "check": {
      tone({ freq: 660, duration: 0.09, type: "sine", gain: 0.15 });
      tone({ freq: 880, duration: 0.1, type: "sine", gain: 0.13, delay: 0.09 });
      break;
    }
    case "solved": {
      // bright ascending arpeggio
      tone({ freq: 523.25, duration: 0.12, type: "triangle", gain: 0.16 });
      tone({ freq: 659.25, duration: 0.12, type: "triangle", gain: 0.16, delay: 0.1 });
      tone({ freq: 783.99, duration: 0.16, type: "triangle", gain: 0.17, delay: 0.2 });
      tone({ freq: 1046.5, duration: 0.22, type: "sine", gain: 0.15, delay: 0.32 });
      break;
    }
    case "wrong": {
      // descending two-tone "nope"
      tone({ freq: 300, duration: 0.14, type: "sawtooth", gain: 0.13, slideTo: 200 });
      tone({ freq: 200, duration: 0.18, type: "sawtooth", gain: 0.12, delay: 0.12, slideTo: 130 });
      break;
    }
  }
}

/**
 * Play a cue. No-ops when muted or on the server.
 */
export function playSound(kind: SoundKind): void {
  if (typeof window === "undefined") return;
  if (isMuted()) return;
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") {
    // Try to resume; if the gesture hasn't happened yet the sound is skipped
    // and the unlock listener will cover the next interaction.
    void c.resume().catch(() => {});
    if (c.state === "suspended") {
      unlockAudio();
      return;
    }
  }
  render(kind);
}

/* --------------------------------------------------------------------------
 * React hook
 * ------------------------------------------------------------------------ */
export interface UseSounds {
  muted: boolean;
  play: (kind: SoundKind) => void;
  setMuted: (muted: boolean) => void;
  toggle: () => void;
}

export function useSounds(): UseSounds {
  // Server + first client render agree (unmuted); sync from storage after mount
  // to avoid a hydration mismatch.
  const [mutedState, setMutedState] = useState(false);

  useEffect(() => {
    setMutedState(isMuted());
    unlockAudio();
    const onStorage = () => setMutedState(isMuted());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const play = useCallback((kind: SoundKind) => {
    playSound(kind);
  }, []);

  const updateMuted = useCallback((next: boolean) => {
    setMuted(next);
    setMutedState(next);
  }, []);

  const toggle = useCallback(() => {
    setMuted(!isMuted());
    setMutedState(isMuted());
  }, []);

  return { muted: mutedState, play, setMuted: updateMuted, toggle };
}
