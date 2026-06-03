#!/bin/sh
set -eu

BASE_DIR="/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/native-ui/iapps-lx/ai-traffic-orchestrator/presentation"
PORT="${1:-8765}"

echo "Serving AI Traffic Orchestrator native UI preview from:"
echo "  ${BASE_DIR}"
echo
echo "Open in a browser:"
echo "  http://127.0.0.1:${PORT}/"
echo

cd "${BASE_DIR}"
python3 -m http.server "${PORT}"
