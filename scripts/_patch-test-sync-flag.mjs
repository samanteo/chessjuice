#!/usr/bin/env node
/**
 * One-shot maintenance: add the cross-device-sync opt-out to the CDP
 * verification scripts.
 *
 * WHY: every cdp-verify-*.mjs starts by clearing localStorage and then asserts a
 * CLEAN SLATE (`attempts === 0`, no glicko key). With sync live, a browser that
 * just cleared its storage immediately re-imports the server's copy from an
 * earlier run, so those assertions fail for a reason unrelated to the behaviour
 * under test. Setting `puzzle_trainer_sync = "off"` makes stateSync a complete
 * no-op, restoring the pre-sync isolation these scripts were written against.
 *
 * cdp-verify-sync.mjs is SKIPPED — it is the one script that must keep sync ON.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "/Users/sam/puzzle-trainer/scripts";
const FLAG = `localStorage.setItem('puzzle_trainer_sync','off');`;

const changed = [];
const skipped = [];

for (const name of readdirSync(dir).sort()) {
  if (!/^cdp-verify-.*\.mjs$/.test(name)) continue;
  if (name === "cdp-verify-sync.mjs") {
    skipped.push(`${name}  (tests sync itself — must stay ON)`);
    continue;
  }
  const path = join(dir, name);
  const src = readFileSync(path, "utf8");

  if (src.includes("puzzle_trainer_sync")) {
    skipped.push(`${name}  (already has the flag)`);
    continue;
  }
  if (!src.includes("localStorage.clear()")) {
    skipped.push(`${name}  (no localStorage.clear() to anchor on)`);
    continue;
  }

  const note =
    "// Keep this test's clean-slate assumption: cross-device sync would otherwise\n" +
    "// re-import server state from an earlier run and break assertions like\n" +
    "// `attempts === 0` that have nothing to do with what is being tested.";

  // Insert immediately after each `await ev(`localStorage.clear()`);` line,
  // preserving that line's indentation.
  const out = src.replace(
    /^([ \t]*)await ev\(`localStorage\.clear\(\)`\);\s*$/gm,
    (line, indent) =>
      `${line}\n${indent}${note.split("\n").join("\n" + indent)}\n${indent}await ev(\`${FLAG}\`);`
  );

  if (out === src) {
    skipped.push(`${name}  (clear() pattern not matched — check manually)`);
    continue;
  }
  writeFileSync(path, out);
  changed.push(name);
}

console.log(`PATCHED ${changed.length} file(s):`);
for (const c of changed) console.log("  " + c);
console.log(`\nSKIPPED ${skipped.length}:`);
for (const s of skipped) console.log("  " + s);
