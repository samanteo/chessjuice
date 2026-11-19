/**
 * Self-contained sound-effect engine for the puzzle trainer.
 *
 * Everything is SYNTHESIZED with the Web Audio API — there are no audio asset
 * files to ship and no extra network requests. The app is served to a phone,
 * so binary assets are deliberately avoided.
 *
 * Design rules (do not break these):
 *   - `window` / `AudioContext` are NEVER touched at module scope. Next.js may
 *     evaluate this module on the server (SSR); it must import cleanly there.
 *   - A single shared AudioContext is created lazily on first use and resumed
 *     if suspended (mobile Safari/Chrome suspend it between gestures).
 *   - Every entry point is wrapped in try/catch. A broken sound must NEVER
 *     break the puzzle.
 *   - All cues are short (< 250ms) with exponential gain ramps so nothing
 *     clicks. Peak gain stays low so it is not jarring on a phone.
 */

export type SoundName =
  | 'move'
  | 'capture'
  | 'check'
  | 'correct'
  | 'wrong'
  | 'hard'
  | 'start';

const STORAGE_KEY = 'puzzle_trainer_sound';

interface SoundPrefs {
  enabled: boolean;
  volume: number;
}

const DEFAULT_PREFS: SoundPrefs = { enabled: true, volume: 0.5 };

function clampVolume(v: number): number {
  if (typeof v !== 'number' || !isFinite(v)) return DEFAULT_PREFS.volume;
  return Math.min(1, Math.max(0, v));
}

// ---------------------------------------------------------------------------
// Preference persistence (localStorage, guarded for SSR / privacy mode).
// ---------------------------------------------------------------------------

function readPrefs(): SoundPrefs {
  try {
    if (typeof globalThis === 'undefined') return { ...DEFAULT_PREFS };
    const ls = (globalThis as any).localStorage;
    if (!ls) return { ...DEFAULT_PREFS };
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
    return {
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_PREFS.enabled,
      volume: clampVolume(parsed.volume),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs: SoundPrefs): void {
  try {
    if (typeof globalThis === 'undefined') return;
    const ls = (globalThis as any).localStorage;
    if (!ls) return;
    ls.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable (SSR / private mode) — ignore */
  }
}

// ---------------------------------------------------------------------------
// AudioContext lifecycle.
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (ctx) return ctx;
    if (typeof globalThis === 'undefined') return null;
    const w = globalThis as any;
    const Ctor: typeof AudioContext | undefined =
      w.AudioContext || w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function ensureRunning(context: AudioContext): void {
  try {
    if (context.state === 'suspended' && typeof context.resume === 'function') {
      // Fire-and-forget: a promise rejection here must not surface.
      void Promise.resolve(context.resume()).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Synthesis primitives.
// ---------------------------------------------------------------------------

interface ToneSpec {
  /** Frequency in Hz. */
  freq: number;
  /** Delay before this tone starts, in seconds. */
  at: number;
  /** Duration in seconds. */
  dur: number;
  /** Peak gain contribution (before the master volume scale). */
  gain: number;
  type?: OscillatorType;
}

/** Play a short sequence of tones with click-free exponential ramps. */
function playTones(context: AudioContext, tones: ToneSpec[], volume: number): void {
  const now = context.currentTime;
  const master = clampVolume(volume);
  for (const t of tones) {
    const osc = context.createOscillator();
    const g = context.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, now + t.at);

    const start = now + t.at;
    const end = start + t.dur;
    // Start near-silent, ramp up quickly, then decay to (near) zero so the
    // oscillator stops cleanly without a click.
    const peak = Math.max(0.0001, t.gain * master);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.01, t.dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(g);
    g.connect(context.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

const RECIPES: Record<SoundName, ToneSpec[]> = {
  // A soft, very quiet low-mid tick.
  move: [{ freq: 320, at: 0, dur: 0.045, gain: 0.06, type: 'triangle' }],
  // A slightly harder / lower thunk.
  capture: [
    { freq: 180, at: 0, dur: 0.11, gain: 0.13, type: 'triangle' },
    { freq: 120, at: 0, dur: 0.11, gain: 0.08, type: 'sine' },
  ],
  // Two-tone alert.
  check: [
    { freq: 660, at: 0, dur: 0.09, gain: 0.11, type: 'square' },
    { freq: 880, at: 0.09, dur: 0.11, gain: 0.11, type: 'square' },
  ],
  // Pleasant ascending arpeggio (C5-E5-G5).
  correct: [
    { freq: 523.25, at: 0, dur: 0.09, gain: 0.12, type: 'sine' },
    { freq: 659.25, at: 0.08, dur: 0.09, gain: 0.12, type: 'sine' },
    { freq: 783.99, at: 0.16, dur: 0.13, gain: 0.12, type: 'sine' },
  ],
  // Descending minor pair (G4 -> Eb4).
  wrong: [
    { freq: 392.0, at: 0, dur: 0.12, gain: 0.12, type: 'sawtooth' },
    { freq: 311.13, at: 0.11, dur: 0.16, gain: 0.12, type: 'sawtooth' },
  ],
  // A neutral low blip, clearly distinct from 'wrong'.
  hard: [{ freq: 220, at: 0, dur: 0.1, gain: 0.1, type: 'triangle' }],
  // A soft rising blip when a puzzle loads.
  start: [
    { freq: 440, at: 0, dur: 0.08, gain: 0.09, type: 'sine' },
    { freq: 587.33, at: 0.07, dur: 0.12, gain: 0.09, type: 'sine' },
  ],
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Play a named cue. No-ops (never throws) when muted or audio is unavailable. */
export function playSound(name: SoundName): void {
  try {
    if (!isSoundEnabled()) return;
    const recipe = RECIPES[name as SoundName];
    if (!recipe) return; // unknown name -> silent no-op, never throw
    const context = getContext();
    if (!context) return; // no Web Audio (SSR / unsupported) -> silent
    ensureRunning(context);
    playTones(context, recipe, getSoundVolume());
  } catch {
    /* a broken sound must never break the puzzle */
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    const prefs = readPrefs();
    prefs.enabled = !!on;
    writePrefs(prefs);
  } catch {
    /* ignore */
  }
}

export function isSoundEnabled(): boolean {
  return readPrefs().enabled;
}

export function setSoundVolume(v: number): void {
  try {
    const prefs = readPrefs();
    prefs.volume = clampVolume(v);
    writePrefs(prefs);
  } catch {
    /* ignore */
  }
}

export function getSoundVolume(): number {
  return readPrefs().volume;
}
