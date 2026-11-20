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

# Fake curl: record that it was called. Can be told to fail selectively, so the
# hostname-then-literal retry path is testable.
cat >"$STUBBIN/curl" <<'EOF'
#!/bin/bash
printf 'curl %s\n' "$*" >>"$CALLS_FILE"

# Emulate real curl's `-o <file>`: notify.sh writes the response body there and
# then greps it for '"ok":true' before believing the send. The stub used to exit 0
# without writing any body, so notify.sh judged EVERY send failed, retried all
# three attempts, and then fell through to `hermes`. That produced three failures
# ("calls the Telegram API" got 3 not 1, "does NOT also hit the main bot" got 1 not
# 0, and the pinned-IPv4 retry case likewise) — the assertions were right, the stub
# was not emulating curl. --fail also means no body on failure, so only write it
# when this attempt is meant to succeed.
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done

fail=0
case "$*" in
  # The pinned-IPv4 retry: fails only if explicitly told to.
  *--resolve*) [ "${FAKE_CURL_FAIL_RESOLVE:-0}" = "1" ] && fail=1 ;;
  # The plain hostname attempt.
  *) [ "${FAKE_CURL_FAIL_HOSTNAME:-0}" = "1" ] && fail=1
     [ "${FAKE_CURL_FAIL:-0}" = "1" ] && fail=1 ;;
esac
[ "$fail" = "1" ] && exit 7
[ -n "$out" ] && printf '{"ok":true,"result":{"message_id":1}}' >"$out"
exit 0
EOF

# Fake hermes: record the arguments. Can be told to fail so the "every channel
# failed" branch — the one the exit-code contract exists for — is testable.
cat >"$STUBBIN/hermes" <<'EOF'
#!/bin/bash
printf 'hermes %s\n' "$*" >>"$CALLS_FILE"
[ "${FAKE_HERMES_FAIL:-0}" = "1" ] && exit 1
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

# ---- 3. alert bot FAILS EVERYWHERE: falls through rather than losing the alert
# Both the hostname attempt and the pinned-IPv4 retries must fail, otherwise the
# retry legitimately rescues it (which case 4 covers).
reset
export FAKE_CURL_FAIL=1 FAKE_CURL_FAIL_HOSTNAME=1 FAKE_CURL_FAIL_RESOLVE=1
run_notify "must not be lost"
unset FAKE_CURL_FAIL FAKE_CURL_FAIL_HOSTNAME FAKE_CURL_FAIL_RESOLVE
ok "$([ "$(n_hermes)" = "1" ] && echo 1 || echo 0)" "alert bot failing -> falls back to the main bot (alert not lost)"

# ---- 4. hostname times out but the pinned IPv4 works ------------------------
# This mirrors the REAL failure on this network: api.telegram.org times out, and
# the gateway works around it by re-walking IPv4 literals. Without the retry the
# dedicated bot would silently never be used and everything would land in the
# main chat — exactly the problem the split exists to solve.
reset
export FAKE_CURL_FAIL_HOSTNAME=1
run_notify "delivered via literal"
unset FAKE_CURL_FAIL_HOSTNAME
ok "$([ "$(n_hermes)" = "0" ] && echo 1 || echo 0)" "hostname times out -> retried via pinned IPv4, NOT dropped to the fallback"
ok "$(grep -q -- '--resolve api.telegram.org:443:149.154.' "$CALLS" && echo 1 || echo 0)" "the retry pins a known-good Telegram IPv4"

# ---- 5. empty message: no calls at all --------------------------------------
reset
run_notify ""
ok "$([ "$(calls)" = "0" ] && echo 1 || echo 0)" "empty message -> sends nothing"

# ---- 5. the exit code must reveal whether anything was actually delivered ----
run_notify "x" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 when delivered"

# The alert bot's hostname attempt fails but the pinned-IPv4 retry succeeds, so the
# alert IS delivered and 0 is correct. (This case used to be labelled "exits 0 even
# when delivery fails", which was misleading in a different way than I first
# thought: with only FAKE_CURL_FAIL set, the --resolve retry still succeeds — nothing
# actually fails and hermes is never reached.)
export FAKE_CURL_FAIL=1
run_notify "x" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 when the pinned-IPv4 retry delivers it"
unset FAKE_CURL_FAIL

# Now make EVERY curl attempt fail, so it must fall through to hermes...
export FAKE_CURL_FAIL FAKE_CURL_FAIL_HOSTNAME=1 FAKE_CURL_FAIL_RESOLVE=1
run_notify "x" >/dev/null 2>&1
ok "$([ "$?" = "0" ] && echo 1 || echo 0)" "exits 0 when the fallback delivers it"
ok "$([ "$(n_hermes)" = "1" ] && echo 1 || echo 0)" "every alert-bot attempt failing -> the fallback is really used"

# ...and when the fallback ALSO fails, the exit code must be NON-ZERO. This is the
# case the contract was rewritten for and it had no test until now: otherwise a
# caller cannot tell a delivered alert from a lost one — and the battery watchdog
# once wrote its "already alerted" marker on a send that never arrived, which
# silenced it for the rest of the episode.
export FAKE_HERMES_FAIL=1
run_notify "x" >/dev/null 2>&1
rc=$?
unset FAKE_HERMES_FAIL FAKE_CURL_FAIL FAKE_CURL_FAIL_HOSTNAME FAKE_CURL_FAIL_RESOLVE
ok "$([ "$rc" != "0" ] && echo 1 || echo 0)" "NON-ZERO exit when EVERY channel fails (a lost alert must not look delivered)"

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
