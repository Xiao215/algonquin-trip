#!/usr/bin/env bash
# Starts the chat backend on localhost and publishes it on port 8443 (443 is left alone because
# another app already uses it): through Tailscale Funnel with an API key, or privately to your own
# tailnet with `tailscale serve` when backend/.env points at a local AI server.
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

if grep -qE '^ANTHROPIC_BASE_URL=https?://(localhost|127\.0\.0\.1)' .env; then
  # Local AI server (e.g. claude-api on a Pro/Max plan): personal use only, so never publish it
  # to the internet. `tailscale serve` (not funnel) keeps it reachable from your own devices only.
  tailscale funnel --https=8443 off >/dev/null 2>&1 || true
  if tailscale status >/dev/null 2>&1; then
    tailscale serve --bg --https=8443 "$PORT" >/dev/null
    echo "Local AI mode: private to your tailnet (your own devices), not on the public internet."
    echo "Open: http://localhost:$PORT/  (phone: https://$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):8443/)"
  else
    echo "Local AI mode: Tailscale is off, so only this Mac can use it (?api=http://localhost:$PORT)."
  fi
  exec uv run python server.py
fi

if ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
  echo "Warning: ANTHROPIC_API_KEY is empty in backend/.env, so the chat will answer with an error." >&2
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale isn't running. Open the Tailscale app (or run: tailscale up) and try again." >&2
  exit 1
fi

tailscale funnel --bg --https=8443 "$PORT"
echo
echo "Public URL (put this in docs/config.js):"
echo "https://$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):8443"
echo

exec uv run python server.py
