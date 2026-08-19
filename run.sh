#!/usr/bin/env bash
# run.sh - start Carrier Dominion locally.
#
#   ./run.sh                 loopback only, http://127.0.0.1:8135
#   ./run.sh --lan           bind 0.0.0.0 so other machines on the LAN can join
#   PORT=9000 ./run.sh       different port
#   SEED=42 ./run.sh         different archipelago
#
# Solo play needs the server too, but only as a static file host: the engine
# runs in the browser tab. Open /?mode=lan to play against the authoritative
# server instead.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8135}"
SEED="${SEED:-20260818}"
HOST="${HOST:-127.0.0.1}"

if [ "${1:-}" = "--lan" ]; then
  HOST="0.0.0.0"
fi

if [ ! -d node_modules ]; then
  echo "installing dependencies..."
  npm install --no-audit --no-fund
fi

echo "Carrier Dominion  http://${HOST}:${PORT}   seed ${SEED}"
echo "  solo: http://127.0.0.1:${PORT}/?mode=solo"
echo "  lan : http://127.0.0.1:${PORT}/?mode=lan"
PORT="$PORT" HOST="$HOST" SEED="$SEED" exec node server/index.js
