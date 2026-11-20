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
#   there is still time to act and the message is never a false alarm. Re-alerts
#   are capped at once per 30 minutes so a long low stretch cannot spam.

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
URGENT_NAG_S=1800   # re-alert at most this often (30 min)

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null; }

notify() {
  local msg="$1"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN would send: $msg"
    return 0
  fi
  if "$NOTIFY" "$msg" >>"$LOG" 2>&1; then
    log "alerted: $msg"
  else
    log "ALERT FAILED to send: $msg"
  fi
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
  # Comfortable. Clear any state so a later drop below LOW_PCT alerts at once
  # instead of being suppressed by an old timestamp.
  rm -f "$STATE"
  exit 0
fi

now="$(date +%s)"
last_alert=0
if [ -f "$STATE" ]; then
  # shellcheck disable=SC1090
  . "$STATE" 2>/dev/null || true
fi
last_alert="${last_alert:-0}"

# Rate-limit, so a long stretch below the threshold cannot spam (once per 30 min).
if [ "$((now - last_alert))" -lt "$URGENT_NAG_S" ]; then
  exit 0
fi

msg="🔴 MacBook battery at ${pct}%${remaining:+ ($remaining)} — nearly empty.

Plug the charger in. If it runs out the Mac shuts down and takes the puzzle trainer (:3000) and the Telegram gateway with it."

notify "$msg"
printf 'last_alert=%s\n' "$now" >"$STATE"
exit 0
