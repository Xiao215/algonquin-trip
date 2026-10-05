#!/usr/bin/env bash
# Starts the chat backend on localhost and publishes it with Tailscale Funnel on port 8443 (443 is
# left alone because another app already uses it). The chat asks for TRIP_CODE from backend/.env.
# Ctrl+C stops the backend. To unpublish: tailscale funnel --https=8443 off
set -euo pipefail
cd "$(dirname "$0")/backend"

if [ ! -f .env ]; then
  echo "Missing backend/.env. Copy backend/.env.example to backend/.env and fill it in." >&2
  exit 1
fi
PORT=$(grep -E '^PORT=' .env | cut -d= -f2 || true); PORT=${PORT:-8790}

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok"'; then
    echo "The trip backend is already running on port $PORT. Nothing to do."
    echo "To restart it: kill \$(lsof -tiTCP:$PORT -sTCP:LISTEN) && ./start.sh"
    exit 0
  fi
  echo "Port $PORT is taken by another program. Set a different PORT in backend/.env." >&2
  exit 1
fi

if ! grep -qE '^ANTHROPIC_BASE_URL=.+' .env && ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
  echo "Warning: neither ANTHROPIC_BASE_URL nor ANTHROPIC_API_KEY is set in backend/.env, so the chat will answer with an error." >&2
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale isn't running. Open the Tailscale app (or run: tailscale up) and try again." >&2
  exit 1
fi

tailscale funnel --bg --https=8443 "$PORT" >/dev/null
echo "Chat backend is public at https://$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):8443 (passcode required)."
echo "Open the site: https://xiao215.github.io/algonquin-trip/"

exec uv run python server.py
