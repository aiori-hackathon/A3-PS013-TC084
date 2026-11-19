#!/usr/bin/env bash
#
# Start the TracePoint backend on the EC2 host.
#
# Restarting by hand kept going wrong in two ways: the Groq key was dropped,
# leaving the assistant dead with no error on the page, and a new process raced
# the old one for the port and exited before it was free. This handles both.
#
#   cd /root/A3-PS013-TC084/backend && ./start_backend.sh
#
set -euo pipefail
cd "$(dirname "$0")"

export PORT="${PORT:-8000}"
export NODE_NO_WARNINGS="${NODE_NO_WARNINGS:-1}"

# The key comes from the environment if it is already there, otherwise from a
# file. Keeping it in a file means a restart cannot silently lose it.
KEY_FILE="${TRACEPOINT_GROQ_KEY_FILE:-/root/.tracepoint_groq_api_key}"
if [ -z "${GROQ_API_KEY:-}" ] && [ -r "$KEY_FILE" ]; then
  GROQ_API_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
fi
export GROQ_API_KEY="${GROQ_API_KEY:-}"

# A real Groq key starts with gsk_ and is around 56 characters. Anything else
# starts a backend whose assistant is dead, with the only symptom appearing on
# the page, so say so here instead.
if [ -z "$GROQ_API_KEY" ]; then
  echo "WARNING: GROQ_API_KEY is empty. The assistant will not work." >&2
  echo "         Put the real key in $KEY_FILE and restart." >&2
elif [ "${GROQ_API_KEY#gsk_}" = "$GROQ_API_KEY" ] || [ ${#GROQ_API_KEY} -lt 40 ]; then
  echo "WARNING: GROQ_API_KEY does not look like a Groq key" >&2
  echo "         (${#GROQ_API_KEY} characters; expected gsk_... and about 56)." >&2
  echo "         Check $KEY_FILE -- a placeholder will not work." >&2
else
  echo "Groq key:  loaded (${#GROQ_API_KEY} characters)"
fi

# Stop any previous instance and wait for it to actually exit. Waiting on the
# port alone was not enough: the old process can still be shutting down, and a
# second start racing the first leaves whichever loses with EADDRINUSE.
PATTERN="node src/server.js"
pkill -f "$PATTERN" 2>/dev/null || true

for _ in $(seq 1 40); do
  pgrep -f "$PATTERN" >/dev/null 2>&1 || break
  sleep 0.5
done

if pgrep -f "$PATTERN" >/dev/null 2>&1; then
  echo "Previous backend did not exit after 20s; forcing it." >&2
  pkill -9 -f "$PATTERN" 2>/dev/null || true
  sleep 1
fi

# Then wait for the listening socket itself to be released.
for _ in $(seq 1 20); do
  ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN || break
  sleep 0.5
done

if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "Port $PORT is still held by something else:" >&2
  ss -ltnp "sport = :$PORT" >&2
  exit 1
fi

echo "Port:      $PORT"
exec node src/server.js
