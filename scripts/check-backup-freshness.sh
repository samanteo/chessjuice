#!/bin/bash
#
# Watchdog: is the puzzle-trainer state actually backed up, right now?
#
# WHY THIS EXISTS SEPARATELY FROM backup-state.sh
# ----------------------------------------------
# backup-state.sh reports on its own success. That cannot catch the failure that
# matters most: the job not running AT ALL (scheduler dead, Mac asleep for a week,
# cron entry removed). A backup that quietly stopped is indistinguishable from a
# healthy one when the only witness is the backup itself.
#
# So this asks independent questions with outside evidence:
#   1. Has the offline copy kept up?      -> compare the state file against GIT
#   2. Is the OFFSITE copy current?       -> ask GitHub, not the local repo
#   3. Is the job still running at all?   -> is the log being appended to?
#
# OUTPUT CONTRACT: silent on stdout when healthy. Speaks only when something is
# actually wrong, so it is safe to run often as a scheduled job.

set -uo pipefail

REPO="/Users/sam/puzzle-trainer"
STATE="user-state/state.json"
LOG="/tmp/puzzle-trainer-backup.log"
# The job runs hourly, so anything beyond a few hours means it stopped.
STALE_HOURS=6

cd "$REPO" || { echo "puzzle-trainer BACKUP WATCHDOG: cannot cd to $REPO"; exit 1; }

problems=()

# ---- 1. Is the state file committed? -------------------------------------
# An uncommitted change that is HOURS old means the backup never picked it up.
if ! git diff --quiet -- "$STATE" || ! git diff --cached --quiet -- "$STATE"; then
  mtime=$(stat -f %m "$STATE" 2>/dev/null || echo 0)
  age_h=$(( ( $(date +%s) - mtime ) / 3600 ))
  if [ "$age_h" -ge "$STALE_HOURS" ]; then
    problems+=("$STATE has been changed but UNCOMMITTED for ${age_h}h — the hourly backup is not running. Run: $REPO/scripts/backup-state.sh")
  fi
fi

# ---- 2. Is the OFFSITE copy current? -------------------------------------
# Ask GitHub what it holds. Comparing local HEAD to origin/main alone would be
# fooled by a stale remote-tracking ref, so this queries the remote directly.
local_head=$(git rev-parse HEAD 2>/dev/null || echo "?")
remote_head=$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)
if [ -z "$remote_head" ]; then
  problems+=("could not reach GitHub to confirm the offsite copy (no network, or SSH auth broken). Your data is only on this laptop.")
elif [ "$local_head" != "$remote_head" ]; then
  behind=$(git rev-list --count "$remote_head..HEAD" 2>/dev/null || echo "?")
  if [ "$behind" != "0" ] && [ "$behind" != "?" ]; then
    problems+=("GitHub is $behind commit(s) behind — pushes are failing. Run: cd $REPO && git push origin main")
  fi
fi

# ---- 3. Is the job still running? ----------------------------------------
if [ ! -f "$LOG" ]; then
  problems+=("no backup log at $LOG — the hourly backup job has never run")
else
  last_line=$(tail -1 "$LOG" 2>/dev/null)
  last_ts=$(echo "$last_line" | cut -d' ' -f1)
  if [ -n "$last_ts" ]; then
    last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$last_ts" "+%s" 2>/dev/null || echo 0)
    if [ "$last_epoch" -gt 0 ]; then
      age_h=$(( ( $(date +%s) - last_epoch ) / 3600 ))
      if [ "$age_h" -ge "$STALE_HOURS" ]; then
        problems+=("the backup has not run in ${age_h}h (last: $last_line). Is the Hermes scheduler still up?")
      fi
    fi
  fi
fi

if [ ${#problems[@]} -eq 0 ]; then
  exit 0   # healthy -> silent
fi

# Build the message ONCE, print it, and exit non-zero. The cron WRAPPER delivers
# it — printing alone reached nobody (the job's `deliver` has no channel in a CLI
# session), and notifying from here as well would double-send via failure_deliver,
# i.e. from the MAIN bot instead of the alert bot.
msg="⚠️ puzzle-trainer BACKUP PROBLEM"
for p in "${problems[@]}"; do
  msg="${msg}
  - ${p}"
done
msg="${msg}

Your puzzles are still safe in the browser and on the Mac; this is about the offsite copy."

printf '%s\n' "$msg"
exit 1
