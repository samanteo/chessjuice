#!/usr/bin/env bash
#
# Battery watchdog for the always-on puzzle-trainer Mac.
#
# WHY THIS EXISTS
# ---------------
# The Mac is set to `disablesleep 1` so it keeps serving with the lid shut. That
# is the point — but it also means it will happily run on battery until it hits
# critical and HARD SHUTS DOWN, killing the puzzle trainer (:3000), the Telegram
# gateway, and (later) Tailscale. Nothing warns you; you find out when the phone
# stops loading the app.
#
# So: page ONLY when the battery is nearly empty while unplugged. Not merely for
# being on battery — unplugging to carry the laptop is normal, and a warning every
# 15 minutes about it is noise that gets ignored.
#
# CONTRACT
#   - SILENT on stdout when healthy. A server watchdog that talks every 15 minutes
#     is a watchdog you learn to ignore.
#   - Talks via scripts/notify.sh (the shared alert channel), NOT stdout — the cron
#     job's own delivery has no channel attached in a CLI session.
#   - Never exits non-zero: a watchdog failing is not something to page about.
#
# THRESHOLD
#   LOW_PCT = 10. Below that there is roughly half an hour of runtime left, so
#   there is still time to act and the message is never a false alarm.
#   ONE message per low episode — it does NOT repeat while the battery stays low,
#   so it cannot nag no matter how long you leave it. Plugging in resets it, so
#   the next time it drops low you are told again (once).

set -uo pipefail

TARGET="telegram:1807170808"
# Overridable so the test suite can run against its own state/log files instead of
# clobbering the real ones.
LOG="${BATTERY_WATCHDOG_LOG:-/tmp/puzzle-trainer-battery.log}"
STATE="${BATTERY_WATCHDOG_STATE:-/tmp/puzzle-trainer-battery.state}"
# Tests/troubleshooting can set BATTERY_WATCHDOG_DRY_RUN=1 to print the alert
# instead of sending it, so the suite never spams the real Telegram channel.
DRY_RUN="${BATTERY_WATCHDOG_DRY_RUN:-0}"
# Delivery goes through the shared notifier, so ALL watchdogs target the same
# channel (a dedicated alert bot when configured). See scripts/notify.sh.
# NOTE: resolve with `cd`+`pwd`, NOT `readlink -f` — that flag is GNU-only and
# BSD/macOS readlink rejects it, which would silently point this at a
# non-existent path. The dry-run guard returns BEFORE notify() runs, so the test
# suite cannot catch that; only a real (non-dry) run proves the path works.
NOTIFY="${NOTIFY_BIN:-$(cd "$(dirname "$0")" && pwd)/notify.sh}"

LOW_PCT=10          # only page below this — see the decision block

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null; }

notify() {
  local msg="$1"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN would send: $msg"
    return 0
  fi
  # Return the REAL delivery result. This used to return 0 unconditionally and
  # log "alerted" even when notify.sh had delivered nothing, which is how the
  # "already told them" marker got written for an alert that never arrived.
  if "$NOTIFY" "$msg" >>"$LOG" 2>&1; then
    log "alerted: $msg"
    return 0
  fi
  log "ALERT FAILED to send: $msg"
  return 1
}

# --- read power source -------------------------------------------------------
# First line is "Now drawing from 'AC Power'" or "'Battery Power'".
# Newer macOS can also say "AC attached" — anything mentioning AC is healthy,
# including "plugged in but held at the charge limit".
batt_out="$(pmset -g batt 2>/dev/null)"
source_line="$(printf '%s\n' "$batt_out" | head -1)"

case "$source_line" in
  *"'AC Power'"* | *"AC attached"*)
    # Healthy. Clear the state so the NEXT battery event alerts immediately
    # instead of being suppressed by the old timestamps.
    rm -f "$STATE"
    exit 0
    ;;
esac

# --- on battery --------------------------------------------------------------
pct="$(printf '%s\n' "$batt_out" | grep -o '[0-9]\{1,3\}%' | head -1 | tr -d '%')"
pct="${pct:-0}"
remaining="$(printf '%s\n' "$batt_out" | grep -o '[0-9]\{1,2\}:[0-9]\{2\} remaining' | head -1)"

# ONLY ONE CONDITION PAGES: unplugged AND below LOW_PCT.
#
# Deliberately NOT "you are on battery". Unplugging to carry the laptop somewhere
# is completely normal, and a message every 15 minutes about it is noise that gets
# ignored — which would defeat the whole point. 10% is roughly half an hour of
# runtime: still time to act, and never a false alarm.
if [ "$pct" -gt "$LOW_PCT" ]; then
  # Recovered. Clear the marker so a LATER drop below the threshold alerts again.
  rm -f "$STATE"
  exit 0
fi

# ONE message per low episode. The state file is a plain "already told them"
# marker, not a re-alert timer: a battery sitting at 6% for an hour would
# otherwise nag on every 15-minute tick, which is exactly the noise that trains
# you to ignore a watchdog. Plugging in (or climbing back above the threshold)
# clears the marker, so the next episode is announced once more.
if [ -f "$STATE" ]; then
  exit 0
fi

msg="🔴 MacBook battery at ${pct}%${remaining:+ ($remaining)} — nearly empty.

Plug the charger in. If it runs out the Mac shuts down and takes the puzzle trainer (:3000) and the Telegram gateway with it."

# ONLY mark the episode as announced if the message actually reached Telegram.
# Writing the marker unconditionally is the "send once, forever" bug: a failed
# send (curl exits 0 on an HTTP 401 without --fail) still wrote the marker, so
# the watchdog went silent for the rest of the episode and never retried.
# Now a failed send leaves no marker, so the next 15-minute tick tries again.
if notify "$msg"; then
  printf 'alerted_at=%s\n' "$(date +%s)" >"$STATE"
else
  log "will retry on the next tick (no marker written)"
fi
exit 0
