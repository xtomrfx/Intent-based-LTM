#!/bin/zsh
set -euo pipefail

export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

F5_HOST="${F5_HOST:-}"
F5_PORT="${F5_PORT:-47002}"
REMOTE_APP_NAME="${REMOTE_APP_NAME:-AITrafficOrchestrator}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="${SCRIPT_DIR}/iapps-lx/ai-traffic-orchestrator"
RUNTIME_SRC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SYNC_GATEWAY_RUNTIME="${SYNC_GATEWAY_RUNTIME:-1}"
REMOTE_DIR="/var/config/rest/iapps/${REMOTE_APP_NAME}"
REMOTE_BLOCK_NAME="${REMOTE_BLOCK_NAME:-AITrafficOrchestrator}"
REMOTE_RUNTIME_DIR="/var/tmp/AITrafficOrchestrator-runtime"
REMOTE_RUNTIME_SRC_DIR="/var/tmp/AITrafficOrchestrator-runtime-src"
REMOTE_ILX_EXTENSION_DIR="/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext"
REMOTE_ILX_PLUGIN_STORE_GLOB="/var/sdm/plugin_store/plugins/:Common:llm_semantic_plugin_*/extensions/llm_semantic_ext"
PACKAGE_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${APP_SRC}/package.json")"

if [[ -z "${F5_HOST}" ]]; then
  echo "Set F5_HOST to the BIG-IP management host before deploying." >&2
  exit 1
fi

if [[ ! -d "${APP_SRC}" ]]; then
  echo "UI source directory not found: ${APP_SRC}" >&2
  exit 1
fi

SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -p "${F5_PORT}"
)

run_ssh() {
  set +e
  ssh "${SSH_OPTS[@]}" "root@${F5_HOST}" "$@"
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 && ${rc} -ne 255 ]]; then
    return "${rc}"
  fi
}

run_tar_copy() {
  set +e
  tar --exclude '._*' --exclude '.DS_Store' -C "${APP_SRC}" -cf - . | ssh "${SSH_OPTS[@]}" "root@${F5_HOST}" "tar -C '${REMOTE_DIR}' -xf -"
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 && ${rc} -ne 255 ]]; then
    return "${rc}"
  fi
}

run_ssh_input() {
  set +e
  ssh "${SSH_OPTS[@]}" "root@${F5_HOST}" "$@"
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 && ${rc} -ne 255 ]]; then
    return "${rc}"
  fi
}

run_runtime_tar_copy() {
  set +e
  tar --exclude '._*' --exclude '.DS_Store' -C "${RUNTIME_SRC_DIR}" -cf - index.js llm_semantic_route.tcl | ssh "${SSH_OPTS[@]}" "root@${F5_HOST}" "rm -rf '${REMOTE_RUNTIME_SRC_DIR}' && mkdir -p '${REMOTE_RUNTIME_SRC_DIR}' && tar -C '${REMOTE_RUNTIME_SRC_DIR}' -xf -"
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 && ${rc} -ne 255 ]]; then
    return "${rc}"
  fi
}

echo "Deploying ${APP_SRC} to root@${F5_HOST}:${REMOTE_DIR}"

run_ssh "rm -rf '${REMOTE_DIR}' && mkdir -p '${REMOTE_DIR}'"

run_tar_copy

run_ssh "
  find '${REMOTE_DIR}' -name '._*' -delete &&
  find '${REMOTE_DIR}' -name '.DS_Store' -delete &&
  find '${REMOTE_DIR}' -type d -exec chmod 755 {} + &&
  find '${REMOTE_DIR}' -type f -exec chmod 644 {} + &&
  chmod 755 '${REMOTE_DIR}/nodejs/apply_config_root.sh' &&
  chown -R root:root '${REMOTE_DIR}' &&
  mkdir -p '${REMOTE_RUNTIME_DIR}' &&
  rm -f '${REMOTE_RUNTIME_DIR}/last-failed-apply.sh' '${REMOTE_RUNTIME_DIR}/no-save.sh' '${REMOTE_RUNTIME_DIR}/test-run.sh' '${REMOTE_RUNTIME_DIR}'/apply-*.sh &&
  chown -R restnoded:restnoded '${REMOTE_RUNTIME_DIR}' &&
  find '${REMOTE_RUNTIME_DIR}' -type d -exec chmod 700 {} + &&
  find '${REMOTE_RUNTIME_DIR}' -type f -exec chmod 600 {} + &&
  ls -la '${REMOTE_DIR}' &&
  echo __VERIFY__ &&
  test -f '${REMOTE_DIR}/presentation/index.html' &&
  test -f '${REMOTE_DIR}/presentation/app.js' &&
  test -f '${REMOTE_DIR}/presentation/styles.css' &&
  test -f '${REMOTE_DIR}/nodejs/appTemplates.json' &&
  cat > /etc/sudoers.d/ai_traffic_orchestrator_restnoded <<'EOSUDO'
restnoded ALL=(root) NOPASSWD: /bin/bash ${REMOTE_DIR}/nodejs/apply_config_root.sh *
EOSUDO
  chmod 440 /etc/sudoers.d/ai_traffic_orchestrator_restnoded
"

if [[ "${SYNC_GATEWAY_RUNTIME}" == "1" ]]; then
  if [[ ! -f "${RUNTIME_SRC_DIR}/index.js" || ! -f "${RUNTIME_SRC_DIR}/llm_semantic_route.tcl" ]]; then
    echo "Runtime source files not found under ${RUNTIME_SRC_DIR}; set SYNC_GATEWAY_RUNTIME=0 to deploy UI only." >&2
    exit 1
  fi

  echo "Syncing gateway runtime index.js and iRule to BIG-IP workspace/plugin_store"
  run_runtime_tar_copy
  run_ssh "
    set -e &&
    ts=\$(date +%Y%m%d%H%M%S) &&
    test -f '${REMOTE_RUNTIME_SRC_DIR}/index.js' &&
    test -f '${REMOTE_RUNTIME_SRC_DIR}/llm_semantic_route.tcl' &&
    ( chgrp sdm '${REMOTE_ILX_EXTENSION_DIR}' 2>/dev/null || true ) &&
    ( chmod 775 '${REMOTE_ILX_EXTENSION_DIR}' || true ) &&
    if [[ -f '${REMOTE_ILX_EXTENSION_DIR}/index.js' ]]; then cp '${REMOTE_ILX_EXTENSION_DIR}/index.js' '${REMOTE_ILX_EXTENSION_DIR}/index.js.bak.deploy.'\"\$ts\"; fi &&
    install -m 0644 '${REMOTE_RUNTIME_SRC_DIR}/index.js' '${REMOTE_ILX_EXTENSION_DIR}/index.js' &&
    chown root:root '${REMOTE_ILX_EXTENSION_DIR}/index.js' || true &&
    matched=0 &&
    for target_dir in ${REMOTE_ILX_PLUGIN_STORE_GLOB}; do
      if [[ -d \"\$target_dir\" ]]; then
        matched=1
        if [[ -f \"\$target_dir/index.js\" ]]; then cp \"\$target_dir/index.js\" \"\$target_dir/index.js.bak.deploy.\"\$ts; fi
        install -m 0644 '${REMOTE_RUNTIME_SRC_DIR}/index.js' \"\$target_dir/index.js\"
        chown root:root \"\$target_dir/index.js\" || true
      fi
    done &&
    if [[ \"\$matched\" -eq 0 ]]; then echo 'Active llm_semantic_plugin plugin_store extension not found' >&2; exit 1; fi &&
    (echo 'ltm rule /Common/llm_semantic_route_phase2 {'; sed 's/^/    /' '${REMOTE_RUNTIME_SRC_DIR}/llm_semantic_route.tcl'; echo '}') > /var/tmp/llm_semantic_route_phase2.deploy.conf &&
    tmsh list ltm rule /Common/llm_semantic_route_phase2 > /var/tmp/llm_semantic_route_phase2.bak.deploy.\"\$ts\".conf || true &&
    tmsh load sys config merge file /var/tmp/llm_semantic_route_phase2.deploy.conf &&
    tmsh modify ilx plugin /Common/llm_semantic_plugin disabled &&
    sleep 1 &&
    tmsh modify ilx plugin /Common/llm_semantic_plugin enabled
  "
fi

BLOCK_PAYLOAD="$(cat <<EOF
{
  \"name\": \"${REMOTE_BLOCK_NAME}\",
  \"inputProperties\": [
    {
      \"id\": \"systemProperties\",
      \"type\": \"JSON\",
      \"value\": {
        \"appCategories\": [\"AI Gateway\"],
        \"appItems\": [
          {
            \"appName\": \"${REMOTE_APP_NAME}\",
            \"name\": \"AI Traffic Orchestrator\",
            \"description\": \"Native AI gateway control plane preview\"
          }
        ],
        \"deviceVersion\": \"17.1.0.1\",
        \"enableDashboard\": true,
        \"modifiedSinceLastDeployment\": \"false\",
        \"module\": \"custom\",
        \"name\": \"${REMOTE_BLOCK_NAME}\",
        \"strictUpdates\": false,
        \"version\": \"${PACKAGE_VERSION}\",
        \"wizardModel\": {
          \"help\": \"off\"
        }
      }
    }
  ],
  \"configurationProcessorReference\": {
    \"link\": \"https://localhost/mgmt/shared/iapp/processors/noop\"
  },
  \"configProcessorTimeoutSeconds\": 30,
  \"statsProcessorTimeoutSeconds\": 15,
  \"configProcessorAffinity\": {
    \"processorPolicy\": \"LOAD_BALANCED\",
    \"affinityProcessorReference\": {
      \"link\": \"https://localhost/mgmt/shared/iapp/processors/affinity/load-balanced\"
    }
  },
  \"state\": \"BOUND\",
  \"settings\": {
    \"allowEditOnBound\": true
  },
  \"presentationHtmlReference\": {
    \"link\": \"https://localhost/mgmt/iapps/${REMOTE_APP_NAME}\"
  }
}
EOF
)"

set +e
EXISTING_JSON="$(
  ssh "${SSH_OPTS[@]}" "root@${F5_HOST}" "curl -sku admin:admin 'https://localhost/mgmt/shared/iapp/blocks?\$filter=name+eq+%27${REMOTE_BLOCK_NAME}%27'"
)"
set -e

EXISTING_ID="$(
  printf '%s' "${EXISTING_JSON}" | python3 -c '
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print("")
    raise SystemExit(0)
try:
    obj = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)
items = obj.get("items", [])
print(items[0]["id"] if items else "")
'
)"

if [[ -n "${EXISTING_ID}" ]]; then
  printf '%s\n' "${BLOCK_PAYLOAD}" | run_ssh "cat > /var/tmp/${REMOTE_APP_NAME}.block.json && curl -sku admin:admin -H 'Content-Type: application/json' -X PUT https://localhost/mgmt/shared/iapp/blocks/${EXISTING_ID} -d @/var/tmp/${REMOTE_APP_NAME}.block.json > /var/tmp/${REMOTE_APP_NAME}.block.response.json"
else
  printf '%s\n' "${BLOCK_PAYLOAD}" | run_ssh "cat > /var/tmp/${REMOTE_APP_NAME}.block.json && curl -sku admin:admin -H 'Content-Type: application/json' -X POST https://localhost/mgmt/shared/iapp/blocks -d @/var/tmp/${REMOTE_APP_NAME}.block.json > /var/tmp/${REMOTE_APP_NAME}.block.response.json"
fi

run_ssh "bigstart restart restnoded"

run_ssh "
  for _ in \$(seq 1 60); do
    code=\$(curl -sk -o /dev/null -w '%{http_code}' -u admin:admin 'https://localhost/mgmt/iapps/${REMOTE_APP_NAME}')
    if [[ \"\$code\" == \"200\" || \"\$code\" == \"401\" ]]; then
      break
    fi
    sleep 2
  done
"

cat <<EOF

TMUI worker entry:
  https://${F5_HOST}/mgmt/iapps/${REMOTE_APP_NAME}

Applications LX block:
  ${REMOTE_BLOCK_NAME}

Static fallback:
  https://${F5_HOST}/iapps/${REMOTE_APP_NAME}/presentation/index.html

Open that URL in the same browser session after logging in to BIG-IP TMUI.
EOF
