#!/bin/bash
#
# Back up the puzzle-trainer's authoritative state to GitHub.
#
# WHY: `user-state/state.json` is the only durable copy of the user's puzzles,
# rating, pins and mistake queue. It is small (~70 KB) and changes whenever they
# solve something. Git gives us BOTH offsite storage and full version history — so
# a bad overwrite is recoverable, which plain file copying does not give you (an
# empty state.json has already had to be recovered from history once).
#
# It commits ONLY that file. Committing everything on a timer would sweep up
# half-finished work and test artifacts.
#
# OUTPUT CONTRACT (this runs as a scheduled job):
#   - Nothing on stdout when all is well  -> the scheduler sends nothing.
#   - A message on stdout ONLY on failure -> the scheduler delivers it, so a
#     broken backup is loud instead of silently stopping. Every run is logged to
#     $LOG regardless.
#
# Safe to run as often as you like: it does nothing when the file is unchanged.

set -uo pipefail

REPO="/Users/sam/puzzle-trainer"
STATE="user-state/state.json"
LOG="/tmp/puzzle-trainer-backup.log"

cd "$REPO" || { echo "puzzle-trainer backup FAILED: cannot cd to $REPO"; exit 1; }

log() { echo "$(date -Iseconds) $*" >>"$LOG"; }

# On failure: log it, print the REASON on stdout, exit non-zero.
#
# The cron WRAPPER owns notification — it turns this stdout into a Telegram alert
# via notify.sh. Do NOT notify from here as well: that double-sends, and the
# second copy would arrive via the cron's failure_deliver, i.e. from the MAIN bot
# in the main chat rather than the alert bot. One failure, one message, one place.
fail() {
  log "FAILED: $1"
  printf '%s\n' "$1"
  exit 1
}

# Refuse to back up a wiped or unparseable file. An empty state.json already
# happened once (a test cleanup ran before the commit); pushing it would destroy
# the good copy on the remote.
if [ ! -s "$STATE" ]; then
  fail "$STATE is empty. Not pushing a wiped file. Restore from git history."
fi

# Snapshot the file ONCE and validate THAT copy. The old version read the live
# file twice (once to validate, once to count), doubling the chance of catching
# a writer mid-write — which is how a transient "not valid JSON" alert fired at
# 13:28 while the file was perfectly fine moments later. A short retry absorbs
# the window instead of waking the user for a false alarm.
SNAP=$(mktemp /tmp/puzzle-state.XXXXXX.json)
trap 'rm -f "$SNAP"' EXIT
valid=0
for _attempt in 1 2 3 4 5; do
  cp -- "$STATE" "$SNAP" 2>/dev/null
  if python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(d,dict) and len(d)>0 else 1)" "$SNAP" 2>/dev/null; then
    valid=1; break
  fi
  sleep 1
done
if [ "$valid" -ne 1 ]; then
  fail "$STATE is not valid JSON after 5 attempts. Restore from git history."
fi

# Nothing changed since the last commit -> still make sure earlier commits are
# pushed. The old version exited 0 here, so commits made by hand (or by another
# script) sat on the laptop forever while the watchdog kept reporting "GitHub is
# N commits behind". A backup job that never pushes is not a backup.
if git diff --quiet -- "$STATE" && git diff --cached --quiet -- "$STATE"; then
  log "no change to $STATE"
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
    if [ "${ahead:-0}" -gt 0 ]; then
      log "state unchanged but HEAD is ${ahead} ahead of origin/main - pushing"
      if git push -q origin main >>"$LOG" 2>&1; then
        log "pushed to origin/main"
        exit 0
      fi
      fail "committed locally but could not push to GitHub. Your data is NOT offsite yet. Check ssh/git access and run: cd $REPO && git push origin main"
    fi
  fi
  exit 0
fi

git add -- "$STATE" || { log "git add failed"; echo "puzzle-trainer backup FAILED: git add"; exit 1; }

COUNT=$(python3 -c "
import json,sys
try:
    s = json.load(open(sys.argv[1]))
    print(len(json.loads(s['puzzle_trainer_attempts']['v'])))
except Exception:
    print('?')
" "$SNAP" 2>/dev/null)

if git commit -q -m "state snapshot: ${COUNT} puzzles $(date '+%Y-%m-%d %H:%M')"; then
  log "committed snapshot (${COUNT} puzzles)"
else
  log "commit reported nothing to do"
  exit 0
fi

if git push -q origin main >>"$LOG" 2>&1; then
  log "pushed to origin/main"
  exit 0
fi

fail "committed locally but could not push to GitHub. Your data is NOT offsite yet. Check ssh/git access and run: cd $REPO && git push origin main"
