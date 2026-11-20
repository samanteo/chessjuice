#!/usr/bin/env bash
#
# Tests for the battery watchdog (scripts/check-battery.sh).
#
# It feeds the watchdog a FAKE `pmset` so every branch is exercised
# deterministically — AC, on-battery, low-battery, the settle window, and the
# re-alert rate limits — instead of waiting on the real power state.
#
# Runs with BATTERY_WATCHDOG_DRY_RUN=1 so nothing is sent to real Telegram, and
# with its own LOG/STATE files so the production state is never touched.

set -uo pipefail

SCRIPT="/Users/sam/puzzle-trainer/scripts/check-battery.sh"
FAKEBIN="$(mktemp -d)"
TLOG="$(mktemp)"
TSTATE="$(mktemp -u)"

pass=0
fail=0
ok() { if [ "$1" = "1" ]; then pass=$((pass + 1)); printf '  PASS %s\n' "$2"; else fail=$((fail + 1)); printf '  FAIL %s\n' "$2"; fi; }

# Fake pmset: echoes whatever is in $FAKE_PMSET_OUT.
cat >"$FAKEBIN/pmset" <<'EOF'
#!/bin/bash
printf '%s\n' "${FAKE_PMSET_OUT:-}"
EOF
chmod +x "$FAKEBIN/pmset"

# Run the watchdog with a given fake power reading. Never sends (dry run).
run_watchdog() {
  FAKE_PMSET_OUT="$1" \
    PATH="$FAKEBIN:$PATH" \
    BATTERY_WATCHDOG_DRY_RUN=1 \
    BATTERY_WATCHDOG_LOG="$TLOG" \
    BATTERY_WATCHDOG_STATE="$TSTATE" \
    "$SCRIPT"
}

# Number of alerts recorded since the log was last reset.
# NOTE: `grep -c` prints "0" AND exits 1 when there are no matches, so a
# `|| echo 0` fallback appends a SECOND line and every `= "0"` comparison fails.
# The command substitution captures stdout regardless of exit status, so the
# count is taken as-is.
alerts_since_reset() {
  local n
  n="$(grep -c 'DRY-RUN would send' "$TLOG" 2>/dev/null)"
  printf '%s' "${n:-0}"
}
reset_log() { : >"$TLOG"; }
clear_state() { rm -f "$TSTATE"; }

# Fake pmset outputs.
AC='Now drawing from '"'"'AC Power'"'"'
 -InternalBattery-0 (id=1)	100%; charged; 0:00 remaining present: true'

BATT_HIGH='Now drawing from '"'"'Battery Power'"'"'
 -InternalBattery-0 (id=1)	85%; discharging; 4:15 remaining present: true'

BATT_LOW='Now drawing from '"'"'Battery Power'"'"'
 -InternalBattery-0 (id=1)	25%; discharging; 1:20 remaining present: true'

echo
echo "=== battery watchdog: $(basename "$SCRIPT") ==="

# ---- 1. AC power: silent, and any battery state is cleared -------------------
clear_state; reset_log
run_watchdog "$AC"
ok "$([ "$(alerts_since_reset)" = "0" ] && echo 1 || echo 0)" "on AC power -> stays silent"
ok "$([ ! -f "$TSTATE" ] && echo 1 || echo 0)" "on AC power -> clears the battery state file"

# ---- 2. AC while a battery state existed (so the next event alerts at once) ---
printf 'since=1\nlast_alert=1\n' >"$TSTATE"
run_watchdog "$AC"
ok "$([ ! -f "$TSTATE" ] && echo 1 || echo 0)" "returning to AC clears a stale battery state"

# ---- 3. Battery, first sighting, not low: settle window, silent --------------
clear_state; reset_log
run_watchdog "$BATT_HIGH"
ok "$([ "$(alerts_since_reset)" = "0" ] && echo 1 || echo 0)" "battery 85% first sighting -> silent (settle window opens)"
ok "$([ -f "$TSTATE" ] && echo 1 || echo 0)" "battery 85% first sighting -> state file written"
ok "$(grep -q 'starting settle window' "$TLOG" && echo 1 || echo 0)" "battery 85% first sighting -> logged as settle window"

# ---- 4. Battery again IMMEDIATELY (inside SETTLE_S): still silent ------------
reset_log
run_watchdog "$BATT_HIGH"
ok "$([ "$(alerts_since_reset)" = "0" ] && echo 1 || echo 0)" "battery 85% a moment later -> still silent (brief unplug swallowed)"

# ---- 5. Battery, settle window elapsed: ALERTS ------------------------------
# Backdate "since" so the Mac looks like it has been on battery for an hour.
printf 'since=%s\nlast_alert=0\n' "$(( $(date +%s) - 3600 ))" >"$TSTATE"
reset_log
run_watchdog "$BATT_HIGH"
ok "$([ "$(alerts_since_reset)" = "1" ] && echo 1 || echo 0)" "battery 85% after the settle window -> alerts once"
ok "$(grep -q '⚠️' "$TLOG" && echo 1 || echo 0)" "battery 85% alert is the WARNING variant"

# ---- 6. Re-alert rate limit: does not nag within NAG_S ----------------------
reset_log
run_watchdog "$BATT_HIGH"
ok "$([ "$(alerts_since_reset)" = "0" ] && echo 1 || echo 0)" "battery 85% again -> silent (rate limited, no nagging)"

# ---- 7. LOW battery: alerts on the FIRST sighting, no settle wait -----------
clear_state; reset_log
run_watchdog "$BATT_LOW"
ok "$([ "$(alerts_since_reset)" = "1" ] && echo 1 || echo 0)" "battery 25% first sighting -> alerts immediately (no settle wait)"
ok "$(grep -q '🔴' "$TLOG" && echo 1 || echo 0)" "battery 25% alert is the URGENT variant"
ok "$(grep -q '25%' "$TLOG" && echo 1 || echo 0)" "battery 25% alert includes the real percentage"

# ---- 8. Low battery does not repeat inside URGENT_NAG_S ---------------------
reset_log
run_watchdog "$BATT_LOW"
ok "$([ "$(alerts_since_reset)" = "0" ] && echo 1 || echo 0)" "battery 25% again -> silent (rate limited)"

# ---- 9. The alert names the consequence (uptime, not just the battery) ------
reset_log; clear_state
run_watchdog "$BATT_LOW"
ok "$(grep -qi 'puzzle trainer' "$TLOG" && echo 1 || echo 0)" "alert explains the real consequence (puzzle trainer goes down)"

# ---- 10. NON-dry wiring: the alert reaches the notifier, and the path resolves
# The dry-run cases above all return BEFORE notify() runs, so they prove nothing
# about the delivery path. This stubs the notifier and asserts it was called —
# the only test that catches a broken NOTIFY path or a bad interpreter.
STUB="$(mktemp -d)"
RECV="$(mktemp -u)"
cat >"$STUB/notify.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >"$NOTIFY_RECEIVED"
exit 0
EOF
chmod +x "$STUB/notify.sh"
clear_state
FAKE_PMSET_OUT="$BATT_LOW" PATH="$FAKEBIN:$PATH" \
  NOTIFY_BIN="$STUB/notify.sh" NOTIFY_RECEIVED="$RECV" \
  BATTERY_WATCHDOG_LOG="$TLOG" BATTERY_WATCHDOG_STATE="$TSTATE" \
  "$SCRIPT"
ok "$([ -s "$RECV" ] && echo 1 || echo 0)" "non-dry run actually reaches the notifier (path resolves)"
ok "$(grep -q 'BATTERY' "$RECV" && echo 1 || echo 0)" "the notifier receives the real alert text"
rm -rf "$STUB" "$RECV"

# ---- 11. Never exits non-zero (a watchdog must not page about itself) -------
clear_state
run_watchdog "$BATT_LOW" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "always exits 0"
run_watchdog "$AC" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 on AC too"

rm -rf "$FAKEBIN" "$TLOG" "$TSTATE"

echo
echo "========================="
printf '  PASS %s   FAIL %s\n' "$pass" "$fail"
echo "========================="
[ "$fail" = "0" ] || exit 1
exit 0
