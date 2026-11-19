/**
 * Cross-device state — the client half of `/api/state`.
 *
 * THE MODEL: THE SERVER IS THE TRUTH. localStorage is a CACHE.
 *
 * This replaced an earlier sync engine that kept two peer copies and reconciled
 * them with per-key timestamps. That design was where every sync bug came from:
 * keys written before the engine existed were never uploaded, a device's blank
 * defaults could beat real data on freshness, and a single oversized request was
 * rejected by the browser and swallowed silently. Reconciling two authorities is
 * intrinsically fiddly; having one authority is not.
 *
 * So now:
 *   1. PULL — on boot, GET the server copy and make it local. Server value wins,
 *      unconditionally, for every key the server holds. If that changed anything
 *      the page reloads ONCE so the stores hydrate from the fresh values (they
 *      read localStorage during mount, so they must not be running when we
 *      overwrite it).
 *   2. PUSH — writes to `puzzle_trainer_*` keys are recorded and sent to the
 *      server. No timestamps decide anything; last writer wins by arrival.
 *   3. A key the server has NEVER seen is uploaded from local (so a first-time
 *      device contributes its state instead of only receiving).
 *
 * SAFETY RULE: nothing is pushed until the first pull has completed. That is what
 * stops a brand-new browser — which writes empty defaults like `[]` on mount —
 * from clobbering real data with them before it has had a chance to read it.
 *
 * FAILS SOFT: if `/api/state` is unreachable the app behaves as a plain
 * per-device install. Writes stay local and are pushed once a connection works.
 */

const PREFIX = "puzzle_trainer_";
/**
 * Keys that look like state but must NEVER sync.
 *
 * `puzzle_trainer_sync` is the test opt-out. If it were uploaded, every device
 * would adopt "off" and sync would silently die everywhere — which is exactly
 * what one stray test flag already did to the user's real browser.
 */
const NEVER_SYNC = new Set(["puzzle_trainer_sync", "puzzle_trainer_sync_reloaded"]);
/** Set for the lifetime of one page load to stop reload loops. */
const RELOAD_FLAG = "puzzle_trainer_sync_reloaded";
/** Opt-out, read BEFORE the first pull. Tests use it for a clean slate. */
const OFF_KEY = "puzzle_trainer_sync";

/** Debounce before flushing changes to the server. */
const PUSH_DEBOUNCE_MS = 600;

let installed = false;
/** Does this stored value carry no user data? (`[]`, `{}`, `""`, `null`) */
function isEmptyValue(v: string | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  const t = v.trim();
  if (t === "" || t === "[]" || t === "{}" || t === '""' || t === "null") return true;
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length === 0;
  } catch {
    /* not JSON — treat as real content */
  }
  return false;
}

/** Has the first pull finished? Nothing is pushed before it has. */
let hydrated = false;
let pendingPush: ReturnType<typeof setTimeout> | null = null;
const dirty = new Set<string>();

/** Throttle so a flurry of focus events cannot hammer the endpoint. */
let lastRefresh = 0;
/** Server had newer data while a puzzle was on screen — apply it when we can. */
let pendingRefresh = false;

/**
 * Re-read the server, because this tab may have been open and idle while another
 * device progressed.
 *
 * Order matters for safety: adopt the server's copy FIRST, then let the user
 * interact. A tab that pushes its stale copy before refreshing is what loses the
 * other device's puzzles.
 *
 * If a puzzle is on the board we must NOT reload — that would throw away a
 * half-solved attempt. Keep `pendingRefresh` and apply it once the board clears.
 */
async function refreshFromServer(): Promise<void> {
  if (!hydrated) return;
  const now = Date.now();
  if (now - lastRefresh < 5_000) return;
  lastRefresh = now;

  let changed = false;
  try {
    changed = await pullState();
  } catch {
    return;
  }
  if (!changed) return;

  // A board on screen means the user is mid-solve.
  if (document.querySelector("[data-board-context]")) {
    pendingRefresh = true;
    return;
  }
  window.location.reload();
}

/** Apply a deferred refresh once the board is gone (checked on each focus). */
function applyPendingRefresh(): void {
  if (!pendingRefresh) return;
  if (document.querySelector("[data-board-context]")) return;
  pendingRefresh = false;
  window.location.reload();
}

const syncDisabled = (): boolean => {
  try {
    return localStorage.getItem(OFF_KEY) === "off";
  } catch {
    return false;
  }
};

/** Keys we own. Excludes bookkeeping and never-sync keys. */
function isStateKey(k: string): boolean {
  return (
    typeof k === "string" &&
    k.startsWith(PREFIX) &&
    !k.endsWith("__sync_clock") &&
    !NEVER_SYNC.has(k)
  );
}

/** Every owned key and its raw value. */
function collectLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isStateKey(k)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

/**
 * Send keys to the server.
 *
 * Batched so no request exceeds fetch's ~64 KiB `keepalive` cap: a real profile's
 * payload is ~70 KB (109 attempts is ~43 KB on its own), and an oversized request
 * is rejected BY THE BROWSER before it leaves.
 */
async function push(keys?: string[]): Promise<void> {
  try {
    const all = collectLocal();
    const list = (keys ?? Object.keys(all)).filter((k) => all[k] !== undefined);
    if (list.length === 0) return;

    const MAX_BYTES = 55_000;
    let batch: Record<string, { v: string; t: number }> = {};
    let size = 2;
    const now = Date.now();

    const flush = async (): Promise<void> => {
      if (Object.keys(batch).length === 0) return;
      const body = JSON.stringify(batch);
      const res = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: body.length < 60_000,
      });
      if (!res.ok) console.warn("[stateSync] push rejected:", res.status, body.length, "bytes");
      batch = {};
      size = 2;
    };

    for (const k of list) {
      const entry = { v: all[k], t: now };
      const cost = JSON.stringify(k).length + JSON.stringify(entry).length + 2;
      if (size + cost > MAX_BYTES) await flush();
      batch[k] = entry;
      size += cost;
    }
    await flush();
  } catch (err) {
    // Offline or endpoint missing — the local copy still works. Warn rather than
    // swallow, so this is visible in DevTools instead of failing invisibly.
    console.warn("[stateSync] push failed:", err);
  }
}

function schedulePush(): void {
  if (pendingPush) clearTimeout(pendingPush);
  pendingPush = setTimeout(() => {
    pendingPush = null;
    // Never push before the first pull: a fresh device writes blank defaults on
    // mount, and sending those would overwrite real data.
    if (!hydrated) return;
    const keys = Array.from(dirty);
    dirty.clear();
    void push(keys);
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Observe writes so they reach the server. The app's stores are untouched and
 * unaware — this only watches.
 */
function wrapSetItem(): void {
  const proto = Storage.prototype;
  if ((proto.setItem as unknown as { __synced?: boolean }).__synced) return;

  const original = proto.setItem;
  const wrapped = function (this: Storage, key: string, value: string) {
    original.call(this, key, value);
    try {
      if (isStateKey(key)) {
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
 * Make the server's copy local. Returns true if anything changed.
 *
 * The server wins for every key it holds. Keys it has never seen stay local and
 * are queued for upload, so a first-time device contributes rather than only
 * receiving.
 */
export async function pullState(): Promise<boolean> {
  let remote: Record<string, { v: string; t: number }> = {};
  let reachable = false;
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();
    remote = json?.state ?? {};
    if (!remote || typeof remote !== "object") return false;
    reachable = true;
  } catch {
    return false; // offline / endpoint absent — stay purely local
  }
  if (!reachable) return false;

  let changed = false;

  for (const [key, entry] of Object.entries(remote)) {
    if (!isStateKey(key)) continue;
    const localV = localStorage.getItem(key);
    // Server is the authority: adopt it whenever it differs. The ONLY exception
    // is the server holding a blank value while we hold real data — adopting that
    // would throw away the user's data for nothing.
    if (entry.v !== localV && !(isEmptyValue(entry.v) && !isEmptyValue(localV))) {
      // Write through the ORIGINAL setItem so we do not echo this back as a local
      // edit (which would immediately re-upload it).
      Storage.prototype.setItem.call(localStorage, key, entry.v);
      changed = true;
    }
  }

  // Keys the server has never seen: contribute ours.
  const local = collectLocal();
  for (const k of Object.keys(local)) {
    if (!Object.prototype.hasOwnProperty.call(remote, k)) dirty.add(k);
  }

  return changed;
}

/**
 * Install sync. Safe to call more than once. `onChanged` fires when the server's
 * data replaced local data (the caller typically reloads once).
 */
export function installStateSync(onChanged?: () => void): void {
  if (installed || typeof window === "undefined") return;
  // Test/debug opt-out, checked BEFORE wrapping setItem so with sync off the app
  // behaves exactly as it did before this module existed.
  if (syncDisabled()) return;
  installed = true;
  wrapSetItem();

  void pullState().then((changed) => {
    hydrated = true;
    // A first-time device has keys the server lacks — send them now that we have
    // safely read the server's copy first.
    if (dirty.size > 0) schedulePush();

    if (!changed) return;
    // Reload once so the stores re-hydrate from the updated localStorage. The flag
    // lives in sessionStorage and stops any reload loop.
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
    onChanged?.();
  });

  // Flush on the way out so the last edit is not lost.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty.size > 0) {
      const keys = Array.from(dirty);
      dirty.clear();
      void push(keys);
    }
    // Coming BACK to the tab is the dangerous moment: a tab left open holds a
    // stale copy, and the next write would push that stale copy over another
    // device's newer progress. Refresh from the server before that can happen.
    if (document.visibilityState === "visible") {
      applyPendingRefresh();
      void refreshFromServer();
    }
  });
  window.addEventListener("focus", () => {
    applyPendingRefresh();
    void refreshFromServer();
  });
  window.addEventListener("beforeunload", () => {
    if (dirty.size > 0) void push(Array.from(dirty));
  });
}

/** Manual escape hatch — a "Sync now" button, or tests. */
export async function syncNow(): Promise<{ pushed: number; changed: boolean }> {
  const before = collectLocal();
  await push(Object.keys(before));
  const changed = await pullState();
  return { pushed: Object.keys(before).length, changed };
}
