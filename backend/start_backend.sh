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

if [ -z "$GROQ_API_KEY" ]; then
  echo "WARNING: GROQ_API_KEY is empty. The backend will start, but the" >&2
  echo "         assistant will report that the key is not configured." >&2
  echo "         Put the key in $KEY_FILE and restart." >&2
else
  echo "Groq key:  loaded (${#GROQ_API_KEY} characters)"
fi

# Wait for a previous process to release the port rather than racing it.
for _ in $(seq 1 40); do
  if ! ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    break
  fi
  sleep 0.5
done

if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "Port $PORT is still in use after 20s. Stop the old process first:" >&2
  echo "  pkill -f 'node src/server.js'" >&2
  exit 1
fi

echo "Port:      $PORT"
exec node src/server.js
