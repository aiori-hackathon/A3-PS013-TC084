#!/usr/bin/env bash
#
# Start the live log collector on the EC2 host.
#
# Every setting can be overridden from the environment; the defaults are what
# the production box uses. The API key is read from a file rather than passed
# as an argument so it does not appear in the process list or shell history.
#
#   cd /root/A3-PS013-TC084/agent && ./start_live_agent.sh
#
set -euo pipefail

KEY_FILE="${TRACEPOINT_KEY_FILE:-/root/.tracepoint_agent_api_key}"
if [ ! -r "$KEY_FILE" ]; then
  echo "Cannot read the agent API key at $KEY_FILE" >&2
  exit 1
fi

AGENT_API_KEY="$(cat "$KEY_FILE")"
export AGENT_API_KEY

export TRACEPOINT_SERVER="${TRACEPOINT_SERVER:-http://127.0.0.1:8000}"
export TRACEPOINT_DEVICE_ID="${TRACEPOINT_DEVICE_ID:-aws-ec2-host-01}"
export TRACEPOINT_LOG_FILE="${TRACEPOINT_LOG_FILE:-/var/log/auth.log}"
export TRACEPOINT_LOG_TYPE="${TRACEPOINT_LOG_TYPE:-auth}"
# The zone the SOURCE log is written in, not the zone we display in.
# auth.log carries no offset, so this is how those timestamps are read.
# The EC2 host runs on UTC; the frontend converts to IST for display.
export TRACEPOINT_TIMEZONE="${TRACEPOINT_TIMEZONE:-UTC}"
export TRACEPOINT_STATE_DIR="${TRACEPOINT_STATE_DIR:-/root/A3-PS013-TC084/agent/live-state}"
export TRACEPOINT_POLL_SECONDS="${TRACEPOINT_POLL_SECONDS:-5}"

# Collect only the accounts named here. Comma-separated; unset to collect
# everything on the host. Lines outside the scope are never collected, and the
# agent prints how many it skipped on every cycle.
export TRACEPOINT_USER_FILTER="${TRACEPOINT_USER_FILTER:-root}"

mkdir -p "$TRACEPOINT_STATE_DIR"

cd "$(dirname "$0")"
exec node agent.js
