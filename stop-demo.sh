#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/semantic-routing-demo}"

for pidfile in "$APP_DIR"/*.pid; do
  if [ -f "$pidfile" ]; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  fi
done

echo "stopped"
