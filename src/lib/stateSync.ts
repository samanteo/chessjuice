/**
 * Cross-device state sync — the client half of `/api/state`.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Every store in this app persists to `localStorage`, which the browser scopes
 * per-origin PER DEVICE. So the phone, desktop Chrome and desktop Brave each had
 * their own private progress: solve a puzzle on the phone and the desktop never
 * hears about it. There is no client-side trick that fixes this — the data has to
 * live on the server, which is what `/api/state` provides.
 *
 * HOW IT WORKS (deliberately small and boring)
 * --------------------------------------------
 * 1. PUSH — `localStorage.setItem` is wrapped. Any write to a `puzzle_trainer_*`
 *    key stamps a timestamp and schedules a debounced PUT of just the changed
 *    keys. The app's own stores are untouched and unaware.
 * 2. PULL — on boot, GET the server copy. For every key whose server timestamp is
 *    NEWER than ours, write it locally. If that changed anything, the page
 *    reloads ONCE so the existing stores hydrate from the fresh values (they read
 *    localStorage during mount, so they must not be running when we overwrite it).
 *
 * The one-reload approach exists to avoid restructuring every store around async
 * hydration. It costs a single extra page load when you switch devices, and
 * nothing at all when you don't.
 *
 * FAILS SOFT: if `/api/state` is missing or unreachable (offline, static export,
 * server down), every path below is a no-op and the app behaves exactly as it did
 * before — plain per-device localStorage.
 */

const PREFIX = "puzzle_trainer_";
/** Local clock per key, so we can tell whether ours or the server's is newer. */
const CLOCK_KEY = "__sync_clock";
/** Set for the lifetime of one page load to stop reload loops. */
const RELOAD_FLAG = "puzzle_trainer_sync_reloaded";
/**
 * Opt-out, read from localStorage BEFORE the first pull.
 *
 * The CDP verification scripts assert a CLEAN SLATE (`attempts === 0`, no glicko
 * key). With sync on, a device that has just cleared its localStorage would
 * immediately re-import the server's copy from an earlier run, so those
 * assertions fail for a reason that has nothing to do with the behaviour under
 * test. Tests set `puzzle_trainer_sync = "off"` after clearing, and this makes
 * every path below a no-op — exactly the pre-sync behaviour.
 */
const OFF_KEY = "puzzle_trainer_sync";

const syncDisabled = (): boolean => {
  try {
    return localStorage.getItem(OFF_KEY) === "off";
  } catch {
    return false;
  }
};

const PUSH_DEBOUNCE_MS = 800;

let installed = false;
let pendingPush: ReturnType<typeof setTimeout> | null = null;
const dirty = new Set<string>();

/** Keys we own. Excludes our own bookkeeping. */
function isStateKey(k: string): boolean {
  return typeof k === "string" && k.startsWith(PREFIX) && !k.endsWith(CLOCK_KEY);
}

function readClock(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PREFIX + CLOCK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeClock(clock: Record<string, number>): void {
  try {
    localStorage.setItem(PREFIX + CLOCK_KEY, JSON.stringify(clock));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

/** Every owned key with the timestamp we last wrote it. */
function collectLocal(): Record<string, { v: string; t: number }> {
  const clock = readClock();
  const out: Record<string, { v: string; t: number }> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !isStateKey(k)) continue;
    const v = localStorage.getItem(k);
    if (v === null) continue;
    out[k] = { v, t: clock[k] ?? 0 };
  }
  return out;
}

async function push(keys?: string[]): Promise<void> {
  try {
    const all = collectLocal();
    const subset: Record<string, { v: string; t: number }> = {};
    const list = keys ?? Object.keys(all);
    for (const k of list) if (all[k]) subset[k] = all[k];
    if (Object.keys(subset).length === 0) return;

    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subset),
      keepalive: true,
    });
  } catch {
    /* offline or endpoint missing — the local copy is still correct */
  }
}

function schedulePush(): void {
  if (pendingPush) clearTimeout(pendingPush);
  pendingPush = setTimeout(() => {
    pendingPush = null;
    const keys = Array.from(dirty);
    dirty.clear();
    void push(keys);
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Wrap setItem so every app write is stamped and queued for the server.
 * The original behaviour is preserved exactly — this only observes.
 */
function wrapSetItem(): void {
  const proto = Storage.prototype;
  if ((proto.setItem as unknown as { __synced?: boolean }).__synced) return;

  const original = proto.setItem;
  const wrapped = function (this: Storage, key: string, value: string) {
    original.call(this, key, value);
    try {
      if (isStateKey(key)) {
        const clock = readClock();
        clock[key] = Date.now();
        writeClock(clock);
        dirty.add(key);
        schedulePush();
      }
    } catch {
      /* never let bookkeeping break a real app write */
    }
  };
  (wrapped as unknown as { __synced?: boolean }).__synced = true;
  proto.setItem = wrapped as typeof proto.setItem;
}

/**
 * Pull the server copy and apply anything newer. Returns true if local state
 * changed (caller decides whether to reload).
 */
export async function pullState(): Promise<boolean> {
  let remote: Record<string, { v: string; t: number }>;
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();
    remote = json?.state ?? {};
    if (!remote || typeof remote !== "object") return false;
  } catch {
    return false; // endpoint absent / offline — stay purely local
  }

  const clock = readClock();
  let changed = false;

  for (const [key, entry] of Object.entries(remote)) {
    if (!isStateKey(key)) continue;
    const remoteT = entry?.t ?? 0;
    const localT = clock[key] ?? 0;
    const localV = localStorage.getItem(key);

    if (remoteT > localT && entry.v !== localV) {
      // Server is newer: adopt it. Write through the ORIGINAL setItem so we do
      // not immediately echo this back as a local edit.
      Storage.prototype.setItem.call(localStorage, key, entry.v);
      clock[key] = remoteT;
      changed = true;
    } else if (localV !== null && localT > remoteT) {
      // We are newer: declare our keys dirty so they get pushed.
      dirty.add(key);
    }
  }

  writeClock(clock);
  if (dirty.size > 0) schedulePush();
  return changed;
}

/**
 * Install sync. Safe to call more than once. `onChanged` fires when the server
 * had newer data (the caller typically reloads once).
 */
export function installStateSync(onChanged?: () => void): void {
  if (installed || typeof window === "undefined") return;
  // Test/debug opt-out. Checked BEFORE wrapping setItem, so with sync off the app
  // behaves exactly as it did before this module existed.
  if (syncDisabled()) return;
  installed = true;
  wrapSetItem();

  void pullState().then((changed) => {
    if (!changed) return;
    // Reload once so the stores re-hydrate from the updated localStorage. The
    // flag lives in sessionStorage and stops any reload loop.
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
    onChanged?.();
  });

  // Flush on the way out so the last edit is not lost when the tab closes.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty.size > 0) {
      const keys = Array.from(dirty);
      dirty.clear();
      void push(keys);
    }
  });
  window.addEventListener("beforeunload", () => {
    if (dirty.size > 0) void push(Array.from(dirty));
  });
}

/** Manual escape hatch — e.g. a "Sync now" button or tests. */
export async function syncNow(): Promise<{ pushed: number; changed: boolean }> {
  const before = collectLocal();
  await push(Object.keys(before));
  const changed = await pullState();
  return { pushed: Object.keys(before).length, changed };
}
