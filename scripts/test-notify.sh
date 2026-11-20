#!/usr/bin/env bash
#
# Tests for scripts/notify.sh — the shared alert notifier.
#
# Both delivery paths are stubbed (fake `curl` and fake `hermes` earlier on PATH),
# so this never sends anything real and every branch is observable.

set -uo pipefail

SCRIPT="/Users/sam/puzzle-trainer/scripts/notify.sh"
STUBBIN="$(mktemp -d)"
CALLS="$(mktemp -u)"
ALERTENV="$(mktemp -u)"

pass=0
fail=0
ok() { if [ "$1" = "1" ]; then pass=$((pass + 1)); printf '  PASS %s\n' "$2"; else fail=$((fail + 1)); printf '  FAIL %s\n' "$2"; fi; }

# Fake curl: record that it was called (and whether it "succeeds").
cat >"$STUBBIN/curl" <<'EOF'
#!/bin/bash
printf 'curl %s\n' "$*" >>"$CALLS_FILE"
[ "${FAKE_CURL_FAIL:-0}" = "1" ] && exit 7
exit 0
EOF

# Fake hermes: record the arguments.
cat >"$STUBBIN/hermes" <<'EOF'
#!/bin/bash
printf 'hermes %s\n' "$*" >>"$CALLS_FILE"
exit 0
EOF
chmod +x "$STUBBIN/curl" "$STUBBIN/hermes"

run_notify() { # $1 = message
  CALLS_FILE="$CALLS" PATH="$STUBBIN:$PATH" \
    ALERT_ENV="$ALERTENV" \
    CURL_BIN="$STUBBIN/curl" \
    HERMES_BIN="$STUBBIN/hermes" \
    ALERT_FALLBACK_TARGET="telegram:999" \
    "$SCRIPT" "$1"
}

calls() { grep -c . "$CALLS" 2>/dev/null | head -1; }
reset() { : >"$CALLS"; }
n_curl() { grep -c '^curl ' "$CALLS" 2>/dev/null | head -1 || true; }
n_hermes() { grep -c '^hermes ' "$CALLS" 2>/dev/null | head -1 || true; }

echo
echo "=== notify.sh ==="

# ---- 1. no dedicated bot configured: falls back to hermes send --------------
rm -f "$ALERTENV"; reset
run_notify "hello"
ok "$([ "$(n_hermes)" = "1" ] && echo 1 || echo 0)" "no alert bot configured -> uses hermes send"
ok "$([ "$(n_curl)" = "0" ] && echo 1 || echo 0)" "no alert bot configured -> does not call the Telegram API directly"
ok "$(grep -q 'telegram:999' "$CALLS" && echo 1 || echo 0)" "honours the configurable fallback target"
ok "$(grep -q 'hello' "$CALLS" && echo 1 || echo 0)" "passes the message through"

# ---- 2. dedicated bot configured: uses the API, NOT the main bot ------------
reset
cat >"$ALERTENV" <<'EOF'
ALERT_BOT_TOKEN=111:FAKE
ALERT_CHAT_ID=42
EOF
run_notify "alert text"
ok "$([ "$(n_curl)" = "1" ] && echo 1 || echo 0)" "alert bot configured -> calls the Telegram API"
ok "$([ "$(n_hermes)" = "0" ] && echo 1 || echo 0)" "alert bot configured -> does NOT also hit the main bot (no duplicates)"
ok "$(grep -q '111:FAKE' "$CALLS" && echo 1 || echo 0)" "uses the configured token"
ok "$(grep -q 'chat_id=42' "$CALLS" && echo 1 || echo 0)" "uses the configured chat id"
ok "$(grep -qv 'parse_mode' "$CALLS" && echo 1 || echo 0)" "sends plain text (no parse_mode to break on _ or *)"

# ---- 3. alert bot FAILS: falls through rather than losing the alert ---------
reset
export FAKE_CURL_FAIL=1
run_notify "must not be lost"
unset FAKE_CURL_FAIL
ok "$([ "$(n_hermes)" = "1" ] && echo 1 || echo 0)" "alert bot failing -> falls back to the main bot (alert not lost)"

# ---- 4. empty message: no calls at all --------------------------------------
reset
run_notify ""
ok "$([ "$(calls)" = "0" ] && echo 1 || echo 0)" "empty message -> sends nothing"

# ---- 5. always exits 0 ------------------------------------------------------
run_notify "x" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 on success"
export FAKE_CURL_FAIL=1
run_notify "x" >/dev/null 2>&1
unset FAKE_CURL_FAIL
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 even when delivery fails"

# ---- 6. a malformed env file must not crash it ------------------------------
reset
printf 'this is not shell =\n' >"$ALERTENV"
run_notify "still works"
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "garbage in the alert env file -> still exits 0"
ok "$([ "$(n_hermes)" = "1" ] && echo 1 || echo 0)" "garbage in the alert env file -> falls back to hermes send"

rm -rf "$STUBBIN" "$CALLS" "$ALERTENV"

echo
echo "========================="
printf '  PASS %s   FAIL %s\n' "$pass" "$fail"
echo "========================="
[ "$fail" = "0" ] || exit 1
exit 0
