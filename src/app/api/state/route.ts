import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Cross-device state store.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app keeps everything in `localStorage`, which is scoped PER BROWSER PER
 * DEVICE. Phone Safari, desktop Chrome and desktop Brave are therefore three
 * isolated silos — the same puzzle solved on the phone is invisible on the
 * desktop, and no amount of client code can change that. This endpoint is the
 * single shared source of truth so every device sees one progress set.
 *
 * NO LOGIN NEEDED: this is a single-user app on a private machine. Accounts and
 * passwords only exist to let STRANGERS reach YOUR data, which is not the threat
 * model here. The protection is that the server is not exposed publicly
 * (LAN + Tailscale), not an auth layer.
 *
 * STORAGE: one small JSON file, INSIDE the git repo (so it is backed up with
 * the code — unlike data/puzzles.sqlite which is 2.4 GB and regenerable).
 *
 * CONFLICTS: last-write-wins PER KEY, compared by timestamp. Per-key granularity
 * means the phone pushing fresh "attempts" cannot clobber the desktop's
 * separately-updated "settings". Pushing one device then the other can never
 * silently wipe progress, which a whole-blob overwrite would.
 */

const STATE_DIR = path.join(process.cwd(), "user-state");
const STATE_FILE = path.join(STATE_DIR, "state.json");
/** Wipes go here first, so a cleared store is always recoverable. Gitignored. */
const ARCHIVE_DIR = path.join(STATE_DIR, "archive");

/** Only keys the app owns are accepted — never an arbitrary key from a request. */
const ALLOWED_PREFIX = "puzzle_trainer_";
/** Guard against a runaway payload; the real state is a few hundred KB at most. */
const MAX_BYTES = 8 * 1024 * 1024;

interface Entry {
  /** The raw localStorage string (already JSON-encoded by the app). */
  v: string;
  /** Epoch ms of the last write to this key. */
  t: number;
}
type Store = Record<string, Entry>;

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    // Missing file on first run is normal, not an error.
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  // Write to a temp file then rename, so an interrupted write can never leave a
  // half-written state file behind (rename is atomic on the same filesystem).
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store), "utf8");
  await fs.rename(tmp, STATE_FILE);
}

const isAllowed = (k: string) => typeof k === "string" && k.startsWith(ALLOWED_PREFIX);

/**
 * Serialize the read-modify-write in PUT.
 *
 * `writeStore` persists the ENTIRE store, so two PUTs in flight both read the
 * same snapshot and the later write ERASES the earlier one's keys. That is not
 * theoretical: a real client fires the batched push AND its own debounced push
 * close together, and keys went missing (progress_v2 and theme_agg_v1 vanished
 * while the other seven landed). Chaining every mutation through one promise
 * makes each PUT atomic with respect to the others — which is all a single-process
 * Next server needs.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // Keep the chain alive even if this link rejects.
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** GET /api/state -> every known key with its timestamp. */
export async function GET() {
  const store = await readStore();
  return NextResponse.json(
    { ok: true, keys: Object.keys(store).length, state: store },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * PUT /api/state
 * Body: { "<key>": { v: "<string>", t: <epoch ms> }, ... }
 * Only entries NEWER than what the server holds are applied (per key).
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "expected an object" }, { status: 400 });
  }

  const incoming = body as Record<string, unknown>;

  // Every mutation goes through the lock so concurrent PUTs cannot erase each
  // other's keys (see withStoreLock).
  return withStoreLock(async () => {
    const store = await readStore();
    let applied = 0;
    let rejected = 0;

    for (const [key, val] of Object.entries(incoming)) {
      if (!isAllowed(key)) {
        rejected++;
        continue;
      }
      const e = val as Partial<Entry>;
      if (!e || typeof e.v !== "string" || typeof e.t !== "number") {
        rejected++;
        continue;
      }
      const existing = store[key];
      if (existing && existing.t >= e.t) {
        // Server copy is the same age or newer — keep it. The client will pick the
        // server's value up on its next pull.
        rejected++;
        continue;
      }
      store[key] = { v: e.v, t: e.t };
      applied++;
    }

    if (applied > 0) await writeStore(store);

    return NextResponse.json(
      { ok: true, applied, rejected, state: store },
      { headers: { "Cache-Control": "no-store" } }
    );
  });
}

/**
 * DELETE /api/state — clear the shared state, REVERSIBLY.
 *
 * Used by the sync verification script (which needs BOTH devices to start from a
 * genuinely empty server, or they immediately adopt state from an earlier run),
 * and available to the user as a deliberate "start my synced progress over".
 *
 * DANGER this function used to have, and no longer does:
 * `STATE_FILE` lives INSIDE the git repo, so the old `fs.rm(STATE_FILE)` deleted
 * the tracked `user-state/state.json` — the user's only durable copy — and a test
 * run (or a stray curl) wiped their real 109 puzzles off disk. It happened twice.
 * So now a wipe:
 *   1. ARCHIVES the current contents to `user-state/archive/state-<ts>.json`
 *      before touching anything, so a wipe is always recoverable even if it was
 *      not committed;
 *   2. writes an EMPTY STORE rather than unlinking, so the tracked file always
 *      exists and `backup-state.sh` cannot commit its absence;
 *   3. refuses unless `?confirm=1`, so a bare `DELETE` cannot nuke it by accident.
 */
export async function DELETE(req: Request) {
  const confirm = new URL(req.url).searchParams.get("confirm");
  if (confirm !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "refusing to wipe state without ?confirm=1",
        hint: "This clears the shared progress store. Add ?confirm=1 if you mean it.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const store = await readStore();
    if (Object.keys(store).length > 0) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.mkdir(ARCHIVE_DIR, { recursive: true });
      await fs.writeFile(path.join(ARCHIVE_DIR, `state-${ts}.json`), JSON.stringify(store), "utf8");
    }
    await writeStore({});
    return NextResponse.json(
      { ok: true, cleared: true, archived: Object.keys(store).length > 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "could not clear state" }, { status: 500 });
  }
}
