#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <bigip-host> <bigip-port> <backup-path> <remote-path> [workspace] [plugin]" >&2
  exit 1
fi

BIGIP_HOST="$1"
BIGIP_PORT="$2"
BACKUP_PATH="$3"
REMOTE_PATH="$4"
WORKSPACE="${5:-llm_ai_gw_ws}"
PLUGIN="${6:-llm_ai_gw_plugin}"

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$BIGIP_HOST" -p "$BIGIP_PORT" \
  "test -f \"$BACKUP_PATH\" && cp \"$BACKUP_PATH\" \"$REMOTE_PATH\" && python3 -m json.tool \"$REMOTE_PATH\" >/dev/null && tmsh modify ilx plugin \"$PLUGIN\" from-workspace \"$WORKSPACE\" >/dev/null 2>&1 && echo \"rolled_back:$REMOTE_PATH\" && echo \"source:$BACKUP_PATH\""
