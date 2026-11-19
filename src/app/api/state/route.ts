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
}

/**
 * DELETE /api/state — wipe the shared state.
 *
 * Used by the sync verification script (which needs BOTH devices to start from a
 * genuinely empty server, or they immediately adopt state from an earlier run),
 * and available to the user as a deliberate "start my synced progress over".
 *
 * This clears the SERVER copy only; each browser keeps its own localStorage until
 * it next pulls. To fully reset, clear the browser too.
 */
export async function DELETE() {
  try {
    await fs.rm(STATE_FILE, { force: true });
    return NextResponse.json({ ok: true, cleared: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "could not clear state" }, { status: 500 });
  }
}
