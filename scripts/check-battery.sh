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
# So: if the Mac is ever drawing from the battery, say so on Telegram.
#
# CONTRACT
#   - SILENT on stdout when healthy (on AC). A server watchdog that talks every
#     15 minutes is a watchdog you learn to ignore.
#   - Talks ONLY via `hermes send`, directly to Telegram. Not stdout — the cron
#     job's own delivery has no channel in a CLI session.
#   - Never exits non-zero: a watchdog failing is not something to page about.
#
# DEBOUNCE
#   A 15-second unplug (moving the laptop, a loose connector) should not fire an
#   alert. So a battery reading has to PERSIST before it counts:
#     - below LOW_PCT  -> alert on the next run, no waiting (it's urgent)
#     - otherwise      -> alert only once the Mac has been on battery >= SETTLE_S
#   Re-alerts are rate-limited so a long outage cannot spam.

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

LOW_PCT=40          # at/below this, alert immediately and urgently
SETTLE_S=120        # a battery reading must persist this long to count
NAG_S=$((6 * 3600)) # normal re-alert interval while on battery
URGENT_NAG_S=1800   # re-alert interval once below LOW_PCT

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

now="$(date +%s)"
since=""
last_alert=0
had_state=0
if [ -f "$STATE" ]; then
  had_state=1
  # shellcheck disable=SC1090
  . "$STATE" 2>/dev/null || true
fi
[ -z "${since:-}" ] && since="$now"
last_alert="${last_alert:-0}"

on_batt_for=$((now - since))
since_last_alert=$((now - last_alert))

should_alert=0
urgent=0

if [ "$pct" -le "$LOW_PCT" ]; then
  # ALREADY LOW: alert on the very first sighting. The settle window exists to
  # swallow a 15-second unplug, and at this level the benefit of waiting is nil —
  # you want to know the moment it happens, not 15 minutes later.
  urgent=1
  if [ "$since_last_alert" -ge "$URGENT_NAG_S" ]; then
    should_alert=1
  fi
elif [ "$had_state" -eq 0 ]; then
  # First sighting and not low: start the settle window and stay quiet. A brief
  # unplug must not page.
  printf 'since=%s\nlast_alert=0\n' "$now" >"$STATE"
  log "battery detected at ${pct}% (starting settle window)"
  exit 0
elif [ "$on_batt_for" -ge "$SETTLE_S" ] && [ "$since_last_alert" -ge "$NAG_S" ]; then
  should_alert=1
fi

if [ "$should_alert" -eq 1 ]; then
  if [ "$urgent" -eq 1 ]; then
    head_icon="🔴"
    tail_txt="Battery is getting low. If it hits critical the Mac shuts down and takes the puzzle trainer + Telegram gateway with it."
  else
    head_icon="⚠️"
    tail_txt="Plug the charger back in — if the battery runs out the Mac shuts down and the puzzle trainer + Telegram gateway go down with it."
  fi

  msg="${head_icon} MacBook is on BATTERY — ${pct}%${remaining:+ ($remaining)}.

${tail_txt}"

  notify "$msg"
  printf 'since=%s\nlast_alert=%s\n' "$since" "$now" >"$STATE"
fi

exit 0
