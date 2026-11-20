#!/usr/bin/env bash
#
# Tests for the battery watchdog (scripts/check-battery.sh).
#
# It feeds the watchdog a FAKE `pmset` so every branch is exercised
# deterministically instead of waiting on the real power state.
#
# The headline requirement these tests exist to protect: being on battery is NOT
# itself an alert. Unplugging to carry the laptop around is normal, and a message
# every 15 minutes about it is noise that gets ignored. ONLY a nearly-empty
# battery (<= 10%) pages.
#
# Runs with BATTERY_WATCHDOG_DRY_RUN=1 so nothing is sent to real Telegram, and
# with its own LOG/STATE files so production state is never touched.

set -uo pipefail

SCRIPT="/Users/sam/puzzle-trainer/scripts/check-battery.sh"
FAKEBIN="$(mktemp -d)"
TLOG="$(mktemp)"
TSTATE="$(mktemp -u)"

pass=0
fail=0
ok() { if [ "$1" = "1" ]; then pass=$((pass + 1)); printf '  PASS %s\n' "$2"; else fail=$((fail + 1)); printf '  FAIL %s\n' "$2"; fi; }

cat >"$FAKEBIN/pmset" <<'EOF'
#!/bin/bash
printf '%s\n' "${FAKE_PMSET_OUT:-}"
EOF
chmod +x "$FAKEBIN/pmset"

run_watchdog() {
  FAKE_PMSET_OUT="$1" \
    PATH="$FAKEBIN:$PATH" \
    BATTERY_WATCHDOG_DRY_RUN=1 \
    BATTERY_WATCHDOG_LOG="$TLOG" \
    BATTERY_WATCHDOG_STATE="$TSTATE" \
    "$SCRIPT"
}

# `grep -c` prints "0" AND exits 1 with no match, so a `|| echo 0` fallback would
# append a SECOND line and break every `= "0"` comparison. Command substitution
# captures stdout regardless of exit status, so take the count as-is.
n_alerts() {
  local n
  n="$(grep -c 'DRY-RUN would send' "$TLOG" 2>/dev/null)"
  printf '%s' "${n:-0}"
}
reset_log() { : >"$TLOG"; }
clear_state() { rm -f "$TSTATE"; }

ac() { printf "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t%s%%; charged; 0:00 remaining present: true" "$1"; }
batt() { printf "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t%s%%; discharging; 1:20 remaining present: true" "$1"; }

echo
echo "=== battery watchdog: $(basename "$SCRIPT") ==="

# ---- 1. on AC: silent, and state is cleared --------------------------------
clear_state; reset_log
run_watchdog "$(ac 100)"
ok "$([ "$(n_alerts)" = "0" ] && echo 1 || echo 0)" "on AC power -> stays silent"
ok "$([ ! -f "$TSTATE" ] && echo 1 || echo 0)" "on AC power -> clears the state file"

# ---- 2. THE HEADLINE CASE: unplugged but healthy -> SILENT ------------------
# This is the whole point of the LOW_PCT threshold.
clear_state; reset_log
run_watchdog "$(batt 85)"
ok "$([ "$(n_alerts)" = "0" ] && echo 1 || echo 0)" "unplugged at 85% -> SILENT (being on battery is not an alert)"
run_watchdog "$(batt 40)"
ok "$([ "$(n_alerts)" = "0" ] && echo 1 || echo 0)" "unplugged at 40% -> SILENT"
run_watchdog "$(batt 11)"
ok "$([ "$(n_alerts)" = "0" ] && echo 1 || echo 0)" "unplugged at 11% -> SILENT (just above the threshold)"

# ---- 3. below the threshold: ALERTS ----------------------------------------
clear_state; reset_log
run_watchdog "$(batt 10)"
ok "$([ "$(n_alerts)" = "1" ] && echo 1 || echo 0)" "unplugged at 10% -> alerts (at the threshold)"
clear_state; reset_log
run_watchdog "$(batt 7)"
ok "$([ "$(n_alerts)" = "1" ] && echo 1 || echo 0)" "unplugged at 7% -> alerts"

# ---- 4. the alert says the percentage and the real consequence --------------
ok "$(grep -q '7%' "$TLOG" && echo 1 || echo 0)" "alert includes the actual percentage"
ok "$(grep -qi 'puzzle trainer' "$TLOG" && echo 1 || echo 0)" "alert explains the consequence (puzzle trainer goes down)"

# ---- 5. ONE message per low episode: it must never repeat -------------------
# Five consecutive ticks at 6% (a battery left low for over an hour) must produce
# EXACTLY one alert. Repeating is the noise that trains you to ignore a watchdog.
clear_state; reset_log
for _ in 1 2 3 4 5; do run_watchdog "$(batt 6)"; done
ok "$([ "$(n_alerts)" = "1" ] && echo 1 || echo 0)" "five ticks at 6% -> exactly ONE alert (no repeats)"

# ---- 6. plugging in then dropping low again alerts once more ---------------
run_watchdog "$(ac 12)"
reset_log
run_watchdog "$(batt 6)"
ok "$([ "$(n_alerts)" = "1" ] && echo 1 || echo 0)" "charge then drop low again -> alerts once (AC resets the marker)"
reset_log
run_watchdog "$(batt 5)"
ok "$([ "$(n_alerts)" = "0" ] && echo 1 || echo 0)" "and then stays silent again for that episode"

# ---- 7. NON-dry wiring: the alert reaches the notifier, and the path resolves
# The dry-run cases return BEFORE notify() runs, so they prove nothing about
# delivery. This stubs the notifier — the only test that catches a broken NOTIFY
# path (e.g. the GNU-only `readlink -f` that BSD/macOS rejects).
STUB="$(mktemp -d)"
RECV="$(mktemp -u)"
cat >"$STUB/notify.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >"$NOTIFY_RECEIVED"
exit 0
EOF
chmod +x "$STUB/notify.sh"
clear_state
FAKE_PMSET_OUT="$(batt 8)" PATH="$FAKEBIN:$PATH" \
  NOTIFY_BIN="$STUB/notify.sh" NOTIFY_RECEIVED="$RECV" \
  BATTERY_WATCHDOG_LOG="$TLOG" BATTERY_WATCHDOG_STATE="$TSTATE" \
  "$SCRIPT"
ok "$([ -s "$RECV" ] && echo 1 || echo 0)" "non-dry run actually reaches the notifier (path resolves)"
ok "$(grep -q 'nearly empty' "$RECV" && echo 1 || echo 0)" "the notifier receives the real alert text"
rm -rf "$STUB" "$RECV"

# ---- 8. always exits 0 ------------------------------------------------------
clear_state
run_watchdog "$(batt 8)" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 when alerting"
run_watchdog "$(ac 100)" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 on AC"

rm -rf "$FAKEBIN" "$TLOG" "$TSTATE"

echo
echo "========================="
printf '  PASS %s   FAIL %s\n' "$pass" "$fail"
echo "========================="
[ "$fail" = "0" ] || exit 1
exit 0
