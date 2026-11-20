#!/usr/bin/env bash
#
# Run every scripts/cdp-verify-*.mjs, keeping the headless browser alive.
#
# WHY THIS EXISTS
# ---------------
# The headless Brave used by the cdp-* harnesses dies partway through a long
# sequential run. Every test after the death then throws a Node stack trace
# trying to reach a dead CDP endpoint — which reads exactly like a test failure
# but is an infrastructure failure. Running the loop by hand produced ~15
# "failures" that all passed when re-run against a live browser.
#
# So: before each test, check the CDP endpoint and relaunch if needed; if a test
# dies with no PASS/FAIL summary at all, relaunch and retry it once.
#
# Usage:  bash scripts/run-cdp-suite.sh [test-name-substring ...]
#         (no args = every cdp-verify-*.mjs)

set -uo pipefail

PORT="${CDP_PORT:-9245}"
PROFILE="/tmp/brave-$PORT"
BRAVE_BIN="${BRAVE_BIN:-/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}"
[ -x "$BRAVE_BIN" ] || BRAVE_BIN="$(command -v Brave || true)"
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

cdp_alive() { curl -sfL -m 4 "http://localhost:$PORT/json/version" >/dev/null 2>&1; }

ensure_browser() {
  cdp_alive && return 0
  log "browser dead -> relaunching on :$PORT"
  pkill -f "remote-debugging-port=$PORT" >/dev/null 2>&1
  sleep 1
  "$BRAVE_BIN" --headless=new --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check --window-size=390,844 >/dev/null 2>&1 &
  for _ in $(seq 1 30); do
    cdp_alive && { log "browser up"; sleep 2; return 0; }
    sleep 1
  done
  log "!! browser would not start on :$PORT"
  return 1
}

# One test, retried once after a browser restart if it produced no summary.
run_one() {
  local f="$1" out rc
  for attempt in 1 2; do
    ensure_browser || return 1
    out="$(cd "$REPO" && node "$f" 2>&1)"
    rc=$?
    # A real result always prints the PASS/FAIL banner. Its absence means the
    # script crashed (dead socket, missing target) rather than failed.
    if printf '%s' "$out" | grep -qE 'PASS [0-9]+ +FAIL [0-9]+|PASS +[0-9]+ checks|PASS +all '; then
      printf '%s\n' "$out" | grep -E 'PASS [0-9]+ +FAIL [0-9]+|PASS +[0-9]+ checks|PASS +all |FAIL ' | tail -4
      return $rc
    fi
    if [ "$attempt" = "1" ]; then
      log "no summary (crash?) -> restarting browser and retrying once"
      pkill -f "remote-debugging-port=$PORT" >/dev/null 2>&1
      sleep 2
    else
      printf '  CRASHED TWICE — not a test result:\n'
      printf '%s\n' "$out" | tail -3 | sed 's/^/    /'
      return 2   # 2 = infrastructure, distinct from 1 = real failing assertions
    fi
  done
}

if [ "$#" -gt 0 ]; then
  FILES=()
  for pat in "$@"; do FILES+=("$DIR"/cdp-verify-*"$pat"*.mjs); done
else
  FILES=("$DIR"/cdp-verify-*.mjs)
fi

total=0 bad=0 crashed=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  total=$((total + 1))
  printf '\n===== %s =====\n' "$name"
  rc=0
  run_one "$f" || rc=$?
  case "$rc" in
    0) ;;
    2) crashed=$((crashed + 1)) ;;
    *) bad=$((bad + 1)) ;;
  esac
done

printf '\n========================================\n  ran %s test files   failing: %s   crashed twice: %s\n========================================\n' \
  "$total" "$bad" "$crashed"
[ "$bad" = "0" ] && [ "$crashed" = "0" ]
