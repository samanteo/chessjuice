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
#   - Exits 0 ONLY when a message was actually accepted by Telegram. Non-zero when
#     every channel failed. Callers that do not care keep using `|| true`.
#     (This used to "ALWAYS exit 0", which made a failed send indistinguishable
#     from a delivered one — and the battery watchdog then wrote its "already
#     alerted" marker on a send that never arrived, so it went silent forever.)
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
telegram_send() {
  local token="$1" chat="$2" text="$3"
  # Try the hostname first, then pin KNOWN-GOOD Telegram IPv4 literals.
  #
  # WHY: on this network a direct call to api.telegram.org simply times out — the
  # gateway logs the same symptom and works around it by "re-walking IPv4
  # literals before the hostname". `--resolve` does that for curl: it connects to
  # the literal address while keeping SNI/Host correct, so TLS still validates.
  local attempt body
  body="$(mktemp 2>/dev/null || echo /tmp/notify-body.$$)"
  for attempt in "" "--resolve|api.telegram.org:443:149.154.166.110" "--resolve|api.telegram.org:443:149.154.167.220"; do
    local -a extra=()
    if [ -n "$attempt" ]; then
      # Split the "flag|value" pair into two argv entries.
      extra=("${attempt%%|*}" "${attempt#*|}")
    fi
    # --fail is ESSENTIAL. Without it curl exits 0 on an HTTP 401/400 — verified:
    # a bogus token returns "exit code = 0" plus {"ok":false,"error_code":401}.
    # That is how an undelivered alert got logged as "alerted" and suppressed the
    # watchdog for the rest of the episode. Telegram also answers 200 with
    # {"ok":false} for some errors, so the body is checked too.
    if "$CURL" -sS --max-time 15 --fail \
      "${extra[@]+"${extra[@]}"}" \
      -X POST "https://api.telegram.org/bot${token}/sendMessage" \
      -d "chat_id=${chat}" \
      --data-urlencode "text=${text}" \
      -o "$body" 2>>"${NOTIFY_LOG:-/dev/null}"; then
      if grep -q '"ok":true' "$body" 2>/dev/null; then
        rm -f "$body"
        return 0
      fi
      printf '%s telegram_send: HTTP ok but body not ok: %s\n' "$(date '+%F %T')" "$(head -c 200 "$body" 2>/dev/null)" >>"${NOTIFY_LOG:-/dev/null}" 2>/dev/null
    else
      printf '%s telegram_send: curl failed (attempt %s): %s\n' "$(date '+%F %T')" "${attempt:-hostname}" "$(head -c 200 "$body" 2>/dev/null)" >>"${NOTIFY_LOG:-/dev/null}" 2>/dev/null
    fi
  done
  rm -f "$body"
  return 1
}

if [ -f "$ALERT_ENV" ]; then
  # shellcheck disable=SC1090
  . "$ALERT_ENV" 2>/dev/null || true
  if [ -n "${ALERT_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
    if telegram_send "$ALERT_BOT_TOKEN" "$ALERT_CHAT_ID" "$MSG"; then
      USE_FALLBACK=0
    fi
  fi
fi

# --- 2. fall back to the main bot --------------------------------------------
# The old version swallowed this with `|| true` and then exited 0 regardless, so
# a total delivery failure looked identical to success. Keep the fallback, but
# report its real result so callers can retry.
if [ "$USE_FALLBACK" = "1" ]; then
  if "$HERMES" send --to "$FALLBACK_TARGET" "$MSG" >/dev/null 2>&1; then
    exit 0
  fi
  printf '%s hermes send to %s failed\n' "$(date '+%F %T')" "$FALLBACK_TARGET" >>"${NOTIFY_LOG:-/dev/null}" 2>/dev/null
  exit 1
fi

exit 0
