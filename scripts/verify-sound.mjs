/**
 * Verifies src/lib/sound.ts headlessly in Node.
 *
 * Transpiles the REAL TypeScript source with the project's installed
 * `typescript` package (same pattern as verify-real-rd.mjs), then imports it
 * with globalThis.window / localStorage / AudioContext stubbed so the audio
 * engine can be exercised without a browser.
 *
 * Asserts:
 *   - muted           => no oscillator created
 *   - enabled         => oscillator created
 *   - volume clamps to 0..1
 *   - a bad/unknown sound name does NOT throw
 *   - playSound does not throw when AudioContext is unavailable
 *   - the preference round-trips through localStorage
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src", "lib");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sound-"));

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    fileName: file,
  }).outputText;
}

const outFile = path.join(outDir, "sound.mjs");
fs.writeFileSync(outFile, transpile(path.join(SRC, "sound.ts")));

// ---------------------------------------------------------------------------
// Headless stubs.
// ---------------------------------------------------------------------------

// Recording fake AudioContext.
const audio = { contexts: 0, oscillators: 0, gains: 0, starts: 0, resumes: 0, lastDest: null };

class FakeGainNode {
  constructor() {
    audio.gains++;
    this.gain = {
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
    };
  }
  connect() {}
}
class FakeOscillatorNode {
  constructor() {
    audio.oscillators++;
    this.type = "sine";
    this.frequency = { setValueAtTime: () => {}, value: 0 };
  }
  connect() {}
  start() { audio.starts++; }
  stop() {}
}
class FakeAudioContext {
  constructor() {
    audio.contexts++;
    this.state = "running";
    this.currentTime = 0;
    this.destination = { connect() {} };
    audio.lastDest = this.destination;
    audio.lastContext = this;
  }
  createOscillator() { return new FakeOscillatorNode(); }
  createGain() { return new FakeGainNode(); }
  resume() { audio.resumes++; this.state = "running"; return Promise.resolve(); }
}

// Minimal localStorage backed by a Map.
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

globalThis.window = { localStorage: localStorageStub };
globalThis.localStorage = localStorageStub;
globalThis.AudioContext = FakeAudioContext;

const S = await import(pathToFileURL(outFile).href);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)); };
const reset = () => { audio.oscillators = 0; audio.gains = 0; audio.starts = 0; audio.resumes = 0; };

// ---------------------------------------------------------------------------

console.log("== A. defaults ==");
store.clear();
ok(S.isSoundEnabled() === true, "sound enabled by default");
ok(S.getSoundVolume() === 0.5, `default volume 0.5 (${S.getSoundVolume()})`);

console.log("\n== B. enabled => oscillator created ==");
reset();
S.playSound("move");
ok(audio.oscillators > 0, `playSound('move') created oscillators (${audio.oscillators})`);
ok(audio.starts > 0, "oscillators were started");

console.log("\n== C. muted => no oscillator created ==");
S.setSoundEnabled(false);
ok(S.isSoundEnabled() === false, "isSoundEnabled() reflects disabled state");
reset();
S.playSound("move");
ok(audio.oscillators === 0, `muted playSound created no oscillators (${audio.oscillators})`);
S.setSoundEnabled(true);

console.log("\n== D. every real cue produces audio ==");
for (const name of ["move", "capture", "check", "correct", "wrong", "hard", "start"]) {
  reset();
  S.playSound(name);
  ok(audio.oscillators > 0, `cue '${name}' -> oscillators (${audio.oscillators})`);
}

console.log("\n== E. a suspended context is resumed ==");
S.playSound("move"); // ensure a context exists
ok(!!audio.lastContext, "an AudioContext was created");
audio.lastContext.state = "suspended";
reset();
S.playSound("correct");
ok(audio.resumes > 0, `playSound resumed a suspended context (${audio.resumes})`);
audio.lastContext.state = "running";

console.log("\n== F. volume clamps to 0..1 ==");
S.setSoundVolume(5);
ok(S.getSoundVolume() === 1, `setSoundVolume(5) -> 1 (${S.getSoundVolume()})`);
S.setSoundVolume(-3);
ok(S.getSoundVolume() === 0, `setSoundVolume(-3) -> 0 (${S.getSoundVolume()})`);
S.setSoundVolume(0.37);
ok(Math.abs(S.getSoundVolume() - 0.37) < 1e-9, `setSoundVolume(0.37) -> 0.37 (${S.getSoundVolume()})`);
S.setSoundVolume(NaN);
ok(S.getSoundVolume() >= 0 && S.getSoundVolume() <= 1, `setSoundVolume(NaN) stays in range (${S.getSoundVolume()})`);

console.log("\n== G. bad / unknown sound name does NOT throw ==");
let threw = false;
reset();
try {
  S.playSound("not-a-sound");
  S.playSound(undefined);
  S.playSound(null);
  S.playSound(123);
  S.playSound("");
} catch (e) {
  threw = true;
}
ok(!threw, "unknown / bad sound names are silent no-ops (no throw)");
ok(audio.oscillators === 0, `unknown names created no oscillators (${audio.oscillators})`);

console.log("\n== H. playSound does not throw when AudioContext is unavailable ==");
// Load a FRESH instance of the module (no cached context) with AudioContext
// deleted, so the "no Web Audio" code path is genuinely exercised.
const outFile2 = path.join(outDir, "sound-noaudio.mjs");
fs.writeFileSync(outFile2, transpile(path.join(SRC, "sound.ts")));
const savedAC = globalThis.AudioContext;
delete globalThis.AudioContext;
delete globalThis.window.AudioContext;
try {
  const S2 = await import(pathToFileURL(outFile2).href + "?noaudio=1");
  threw = false;
  try {
    S2.playSound("check");
    S2.playSound("move");
    S2.playSound("start");
  } catch (e) {
    threw = true;
  }
  ok(!threw, "fresh playSound is silent (not throwing) without AudioContext");
} catch (e) {
  fail++;
  console.log("  FAIL importing module without AudioContext threw:", e.message);
} finally {
  globalThis.AudioContext = savedAC;
}

console.log("\n== I. preference round-trips through localStorage ==");
ok(store.has("puzzle_trainer_sound"), "writes under key 'puzzle_trainer_sound'");
S.setSoundEnabled(false);
S.setSoundVolume(0.25);
const raw = store.get("puzzle_trainer_sound");
ok(typeof raw === "string", "persisted as a JSON string");
const parsed = JSON.parse(raw);
ok(parsed.enabled === false, `JSON.enabled persisted (${parsed.enabled})`);
ok(Math.abs(parsed.volume - 0.25) < 1e-9, `JSON.volume persisted (${parsed.volume})`);
ok(S.isSoundEnabled() === false, "isSoundEnabled() reads persisted value");
ok(Math.abs(S.getSoundVolume() - 0.25) < 1e-9, "getSoundVolume() reads persisted value");

// Simulate a fresh "page load" reading the same storage.
store.set("puzzle_trainer_sound", JSON.stringify({ enabled: true, volume: 0.8 }));
ok(S.isSoundEnabled() === true, "reads enabled from pre-existing storage");
ok(Math.abs(S.getSoundVolume() - 0.8) < 1e-9, "reads volume from pre-existing storage");

// Corrupt storage must not throw and must fall back to defaults.
store.set("puzzle_trainer_sound", "{not json");
ok(S.isSoundEnabled() === true, "corrupt JSON -> default enabled");
ok(S.getSoundVolume() === 0.5, "corrupt JSON -> default volume");

console.log(`\n=========================\n  PASS ${pass}   FAIL ${fail}\n=========================`);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
