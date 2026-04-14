#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <local-config-json> <bigip-host> <bigip-port> [remote-path] [workspace] [plugin]" >&2
  exit 1
fi

LOCAL_CONFIG="$1"
BIGIP_HOST="$2"
BIGIP_PORT="$3"
REMOTE_PATH="${4:-/var/ilx/workspaces/Common/llm_ai_gw_ws/extensions/gateway/gateway-config.json}"
WORKSPACE="${5:-llm_ai_gw_ws}"
PLUGIN="${6:-llm_ai_gw_plugin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/validate_gateway_config.js" "$LOCAL_CONFIG"

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$BIGIP_HOST" -p "$BIGIP_PORT" \
  "TMP_PATH=\"${REMOTE_PATH}.tmp.$$\"; BACKUP_PATH=\"${REMOTE_PATH}.bak.\$(date +%Y%m%d%H%M%S)\"; cat > \"\$TMP_PATH\" && python3 -m json.tool \"\$TMP_PATH\" >/dev/null && cp \"$REMOTE_PATH\" \"\$BACKUP_PATH\" && mv \"\$TMP_PATH\" \"$REMOTE_PATH\" && tmsh modify ilx plugin \"$PLUGIN\" from-workspace \"$WORKSPACE\" >/dev/null 2>&1 && echo \"published:$REMOTE_PATH\" && echo \"backup:\$BACKUP_PATH\"" < "$LOCAL_CONFIG"
