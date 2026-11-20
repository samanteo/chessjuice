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
# THRESHOLDS
#   LOW_PCT  = 10 — first warning, roughly half an hour of runtime left.
#   CRIT_PCT = 5  — second warning, the last chance to plug in.
#   ONE message per threshold per low episode: it does NOT repeat while the
#   battery stays low, so it cannot nag. Plugging in (or climbing back above 10%)
#   clears both markers, so the next episode is announced once more.
#   If the battery skips past 10% between ticks (12 -> 4), only the critical
#   message is sent — no point paging twice in the same run.

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

LOW_PCT=10          # first warning — see the decision block
CRIT_PCT=5          # second, critical warning
# One marker PER threshold, derived from the base path so the test suite can
# still point BATTERY_WATCHDOG_STATE at its own sandbox.
MARK_LOW="${STATE}.low"
MARK_CRIT="${STATE}.crit"

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
    # Healthy. Clear the markers so the NEXT battery event alerts immediately
    # instead of being suppressed by the old timestamps.
    rm -f "$MARK_LOW" "$MARK_CRIT" "$STATE"
    exit 0
    ;;
esac

# --- on battery --------------------------------------------------------------
pct="$(printf '%s\n' "$batt_out" | grep -o '[0-9]\{1,3\}%' | head -1 | tr -d '%')"
pct="${pct:-0}"
remaining="$(printf '%s\n' "$batt_out" | grep -o '[0-9]\{1,2\}:[0-9]\{2\} remaining' | head -1)"

# Pages ONLY when unplugged AND below a threshold.
#
# Deliberately NOT "you are on battery". Unplugging to carry the laptop somewhere
# is completely normal, and a message every 15 minutes about it is noise that gets
# ignored — which would defeat the whole point.
if [ "$pct" -gt "$LOW_PCT" ]; then
  # Recovered above the first threshold. Clear BOTH markers so a later drop
  # announces each tier again.
  rm -f "$MARK_LOW" "$MARK_CRIT" "$STATE"
  exit 0
fi

# Two tiers, one message each per low episode. The markers are plain "already
# told them" flags, not re-alert timers: a battery sitting at 6% for an hour would
# otherwise nag on every 15-minute tick, which is exactly the noise that trains
# you to ignore a watchdog. Plugging in (or climbing back above 10%) clears them.
#
# Below 5% only the CRITICAL message goes out — if the battery skipped past the
# 10% tier between ticks, paging twice in one run is just noise.
if [ "$pct" -le "$CRIT_PCT" ]; then
  [ -f "$MARK_CRIT" ] && exit 0
  msg="🔴 MacBook battery CRITICAL at ${pct}%${remaining:+ ($remaining)} — about to shut down.

Plug the charger in NOW. When it runs out the Mac hard-shuts and takes the puzzle trainer (:3000) and the Telegram gateway with it."
  # Mark ONLY on real delivery — a failed send must retry on the next tick.
  if notify "$msg"; then
    printf 'alerted_at=%s\n' "$(date +%s)" >"$MARK_CRIT"
    # Suppress the 10% tier too: this episode already got its warning.
    printf 'alerted_at=%s\n' "$(date +%s)" >"$MARK_LOW"
  else
    log "critical alert FAILED to send — will retry on the next tick (no marker written)"
  fi
  exit 0
fi

# 6-10%: the first warning.
[ -f "$MARK_LOW" ] && exit 0
msg="🟠 MacBook battery at ${pct}%${remaining:+ ($remaining)} — running low.

Plug the charger in. If it runs out the Mac shuts down and takes the puzzle trainer (:3000) and the Telegram gateway with it."
if notify "$msg"; then
  printf 'alerted_at=%s\n' "$(date +%s)" >"$MARK_LOW"
else
  log "low alert FAILED to send — will retry on the next tick (no marker written)"
fi
exit 0
