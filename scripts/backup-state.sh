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

# Nothing changed since the last commit -> silent success.
if git diff --quiet -- "$STATE" && git diff --cached --quiet -- "$STATE"; then
  log "no change, nothing to do"
  exit 0
fi

git add -- "$STATE" || { log "git add failed"; echo "puzzle-trainer backup FAILED: git add"; exit 1; }

# Refuse to back up a wiped or unparseable file. An empty state.json already
# happened once (a test cleanup ran before the commit); pushing it would destroy
# the good copy on the remote.
if [ ! -s "$STATE" ]; then
  fail "$STATE is empty. Not pushing a wiped file. Restore from git history."
fi
if ! python3 -c "import json,sys; d=json.load(open('$STATE')); sys.exit(0 if isinstance(d,dict) and len(d)>0 else 1)" 2>/dev/null; then
  fail "$STATE is not valid JSON. Restore from git history."
fi

COUNT=$(python3 -c "
import json
try:
    s = json.load(open('$STATE'))
    print(len(json.loads(s['puzzle_trainer_attempts']['v'])))
except Exception:
    print('?')
" 2>/dev/null)

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
