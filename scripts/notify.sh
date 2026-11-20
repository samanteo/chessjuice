#!/usr/bin/env bash
#
# notify.sh "message" — THE single place that knows how to reach the alert channel.
#
# WHY THIS EXISTS
# ---------------
# Three watchdogs need to page the user (backup, backup-freshness, battery) and
# they were using three different mechanisms:
#   - check-battery.sh          -> `hermes send`  (worked)
#   - check-backup-freshness.sh -> stdout only    (reached NOBODY — its cron job
#   - backup-state.sh (failure) -> stdout only     delivers to a CLI session with
#                                                   no channel attached)
# Routing all of them through here means the delivery target becomes a one-line
# change, and "where do alerts go?" has exactly one answer.
#
# TARGET, in order of preference
#   1. A DEDICATED alert bot — config at ~/.hermes/alert-bot.env
#      (ALERT_BOT_TOKEN + ALERT_CHAT_ID). This is the point of the split: the
#      assistant chat is a CONVERSATION, and a rare failure notice posted into it
#      scrolls away and is never seen. A separate bot is its own chat, so it can
#      be pinned and stays empty until something is actually wrong.
#   2. `hermes send` — the main bot. Used until a dedicated one exists, so alerts
#      are never silently dropped while the user is still setting things up.
#
# CONTRACT
#   - ALWAYS exits 0. A notifier that fails must not make the caller look broken.
#   - Plain text, no parse_mode: the messages contain emoji, paths, and shell
#     flags, and Telegram Markdown breaks on characters like `_` and `*`.
#   - If the dedicated bot fails, fall through to the main bot rather than losing
#     the alert. Delivered in the wrong chat beats not delivered.

set -uo pipefail

MSG="${1:-}"
[ -n "$MSG" ] || exit 0

# Overridable so the test suite can point these at stubs.
ALERT_ENV="${ALERT_ENV:-$HOME/.hermes/alert-bot.env}"
HERMES="${HERMES_BIN:-$HOME/.hermes/hermes-agent/venv/bin/hermes}"
FALLBACK_TARGET="${ALERT_FALLBACK_TARGET:-telegram:1807170808}"
CURL="${CURL_BIN:-curl}"
USE_FALLBACK=1

# --- 1. dedicated alert bot --------------------------------------------------
if [ -f "$ALERT_ENV" ]; then
  # shellcheck disable=SC1090
  . "$ALERT_ENV" 2>/dev/null || true
  if [ -n "${ALERT_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
    if "$CURL" -sS --max-time 20 -X POST \
      "https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${ALERT_CHAT_ID}" \
      --data-urlencode "text=${MSG}" \
      -o /dev/null; then
      USE_FALLBACK=0
    fi
  fi
fi

# --- 2. fall back to the main bot --------------------------------------------
if [ "$USE_FALLBACK" = "1" ]; then
  "$HERMES" send --to "$FALLBACK_TARGET" "$MSG" >/dev/null 2>&1 || true
fi

exit 0
