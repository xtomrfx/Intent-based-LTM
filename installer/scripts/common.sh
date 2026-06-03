#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  echo "This installer requires bash." >&2
  exit 2
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

MANIFEST_FILE="${BUNDLE_ROOT}/manifest.json"
SHA_FILE="${BUNDLE_ROOT}/SHA256SUMS"
PAYLOAD_DIR="${BUNDLE_ROOT}/payload"

AITO_APP_NAME="${AITO_APP_NAME:-AITrafficOrchestrator}"
AITO_BLOCK_NAME="${AITO_BLOCK_NAME:-AITrafficOrchestrator}"
AITO_PARTITION="${AITO_PARTITION:-Common}"
AITO_WORKSPACE_NAME="${AITO_WORKSPACE_NAME:-llm_semantic_ws}"
AITO_EXTENSION_NAME="${AITO_EXTENSION_NAME:-llm_semantic_ext}"
AITO_PLUGIN_NAME="${AITO_PLUGIN_NAME:-llm_semantic_plugin}"
AITO_IRULE_NAME="${AITO_IRULE_NAME:-llm_semantic_route_phase2}"
AITO_RUNTIME_USER="${AITO_RUNTIME_USER:-restnoded}"

APP_DIR="/var/config/rest/iapps/${AITO_APP_NAME}"
APP_WORKER_DIR="${APP_DIR}/nodejs"
RUNTIME_DIR="/var/tmp/AITrafficOrchestrator-runtime"
DEPLOYED_CONFIG_FILE="${RUNTIME_DIR}/deployed-config.json"
ILX_WORKSPACE="/${AITO_PARTITION}/${AITO_WORKSPACE_NAME}"
ILX_PLUGIN="/${AITO_PARTITION}/${AITO_PLUGIN_NAME}"
ILX_IRULE="/${AITO_PARTITION}/${AITO_IRULE_NAME}"
ILX_EXTENSION_DIR="/var/ilx/workspaces/${AITO_PARTITION}/${AITO_WORKSPACE_NAME}/extensions/${AITO_EXTENSION_NAME}"
ILX_NATIVE_DIR="${ILX_EXTENSION_DIR}/native"
PLUGIN_STORE_EXTENSION_GLOB="/var/sdm/plugin_store/plugins/:${AITO_PARTITION}:${AITO_PLUGIN_NAME}_*/extensions/${AITO_EXTENSION_NAME}"
SUDOERS_FILE="/etc/sudoers.d/ai_traffic_orchestrator_restnoded"
BACKUP_ROOT="${AITO_BACKUP_ROOT:-/var/tmp/AITrafficOrchestrator-install-backups}"

json_string() {
  local key="$1"
  local file="${2:-${MANIFEST_FILE}}"
  sed -n 's/.*"'${key}'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${file}" | head -1
}

AITO_VERSION="${AITO_VERSION:-$(json_string version)}"
if [[ -z "${AITO_VERSION}" ]]; then
  AITO_VERSION="unknown"
fi

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "Run this installer as root on BIG-IP."
  fi
}

hash_file() {
  local file="$1"

  if have sha256sum; then
    sha256sum "${file}" | awk '{print $1}'
    return
  fi
  if have shasum; then
    shasum -a 256 "${file}" | awk '{print $1}'
    return
  fi
  if have openssl; then
    openssl dgst -sha256 "${file}" | awk '{print $NF}'
    return
  fi
  die "No SHA-256 tool found. Need sha256sum, shasum, or openssl."
}

verify_bundle_checksums() {
  local expected
  local file
  local normalized
  local actual

  [[ -f "${SHA_FILE}" ]] || die "Missing checksum file: ${SHA_FILE}"
  while read -r expected file; do
    [[ -n "${expected:-}" ]] || continue
    normalized="${file#./}"
    [[ "${normalized}" == "SHA256SUMS" ]] && continue
    [[ -f "${BUNDLE_ROOT}/${normalized}" ]] || die "Checksum target missing: ${normalized}"
    actual="$(hash_file "${BUNDLE_ROOT}/${normalized}")"
    if [[ "${actual}" != "${expected}" ]]; then
      die "Checksum mismatch for ${normalized}: expected ${expected}, got ${actual}"
    fi
  done < "${SHA_FILE}"
}

tmsh_has() {
  local pattern="$1"
  local output

  shift
  output="$(tmsh "$@" 2>&1 || true)"
  grep -q "${pattern}" <<< "${output}"
}

ensure_dir() {
  local dir="$1"

  mkdir -p "${dir}"
}

runtime_group() {
  id -gn "${AITO_RUNTIME_USER}" 2>/dev/null || printf '%s\n' "${AITO_RUNTIME_USER}"
}

ensure_runtime_user() {
  id "${AITO_RUNTIME_USER}" >/dev/null 2>&1 || die "Required runtime user not found: ${AITO_RUNTIME_USER}"
}

set_runtime_permissions() {
  local group_name

  ensure_runtime_user
  [[ -d "${RUNTIME_DIR}" ]] || return 0

  group_name="$(runtime_group)"
  chown -R "${AITO_RUNTIME_USER}:${group_name}" "${RUNTIME_DIR}"
  find "${RUNTIME_DIR}" -type d -exec chmod 700 {} +
  find "${RUNTIME_DIR}" -type f -exec chmod 600 {} +
}

copy_tree() {
  local source_dir="$1"
  local target_dir="$2"

  rm -rf "${target_dir}"
  mkdir -p "${target_dir}"
  (
    cd "${source_dir}"
    tar --exclude '._*' --exclude '.DS_Store' --exclude '__MACOSX' -cf - .
  ) | (
    cd "${target_dir}"
    tar -xf -
  )
}

copy_tree_contents() {
  local source_dir="$1"
  local target_dir="$2"

  mkdir -p "${target_dir}"
  (
    cd "${source_dir}"
    tar --exclude '._*' --exclude '.DS_Store' --exclude '__MACOSX' -cf - .
  ) | (
    cd "${target_dir}"
    tar -xf -
  )
}

write_block_payload() {
  local output_file="$1"

  cat > "${output_file}" <<EOF
{
  "name": "${AITO_BLOCK_NAME}",
  "inputProperties": [
    {
      "id": "systemProperties",
      "type": "JSON",
      "value": {
        "appCategories": ["AI Gateway"],
        "appItems": [
          {
            "appName": "${AITO_APP_NAME}",
            "name": "AI Traffic Orchestrator",
            "description": "Native AI gateway control plane"
          }
        ],
        "deviceVersion": "17.1.0.1",
        "enableDashboard": true,
        "modifiedSinceLastDeployment": "false",
        "module": "custom",
        "name": "${AITO_BLOCK_NAME}",
        "strictUpdates": false,
        "version": "${AITO_VERSION}",
        "wizardModel": {
          "help": "off"
        }
      }
    }
  ],
  "configurationProcessorReference": {
    "link": "https://localhost/mgmt/shared/iapp/processors/noop"
  },
  "configProcessorTimeoutSeconds": 30,
  "statsProcessorTimeoutSeconds": 15,
  "configProcessorAffinity": {
    "processorPolicy": "LOAD_BALANCED",
    "affinityProcessorReference": {
      "link": "https://localhost/mgmt/shared/iapp/processors/affinity/load-balanced"
    }
  },
  "state": "BOUND",
  "settings": {
    "allowEditOnBound": true
  },
  "presentationHtmlReference": {
    "link": "https://localhost/mgmt/iapps/${AITO_APP_NAME}"
  }
}
EOF
}

restcurl_required() {
  have restcurl || die "restcurl is required to register the iApps LX block."
}

register_iapp_block() {
  local payload_file="/var/tmp/${AITO_APP_NAME}.block.json"
  local body
  local existing_json
  local existing_id

  restcurl_required
  write_block_payload "${payload_file}"
  body="$(cat "${payload_file}")"
  existing_json="$(restcurl "/shared/iapp/blocks?\$filter=name+eq+%27${AITO_BLOCK_NAME}%27" 2>/dev/null || true)"
  existing_id="$(awk '
    /"id"[[:space:]]*:[[:space:]]*"/ {
      line = $0
      sub(/^.*"id"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
  ' <<< "${existing_json}")"

  if [[ -n "${existing_id}" ]]; then
    log "Updating iApps LX block ${AITO_BLOCK_NAME} (${existing_id})"
    restcurl -X PUT "/shared/iapp/blocks/${existing_id}" -d "${body}" >/var/tmp/${AITO_APP_NAME}.block.response.json
  else
    log "Creating iApps LX block ${AITO_BLOCK_NAME}"
    restcurl -X POST "/shared/iapp/blocks" -d "${body}" >/var/tmp/${AITO_APP_NAME}.block.response.json
  fi
}

get_iapp_block_json() {
  restcurl "/shared/iapp/blocks?\$filter=name+eq+%27${AITO_BLOCK_NAME}%27" 2>/dev/null || true
}

get_iapp_block_id() {
  awk '
    /"id"[[:space:]]*:[[:space:]]*"/ {
      line = $0
      sub(/^.*"id"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
  ' <<< "$(get_iapp_block_json)"
}

get_iapp_block_state_by_id() {
  local block_id="$1"

  awk '
    /"state"[[:space:]]*:[[:space:]]*"/ {
      line = $0
      sub(/^.*"state"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
  ' <<< "$(
    restcurl "/shared/iapp/blocks/${block_id}" 2>/dev/null || true
  )"
}

delete_iapp_block_if_exists() {
  local block_id
  local state
  local attempt

  restcurl_required
  block_id="$(get_iapp_block_id)"
  [[ -n "${block_id}" ]] || return 0

  state="$(get_iapp_block_state_by_id "${block_id}")"
  if [[ "${state}" == "BOUND" ]]; then
    log "Unbinding iApps LX block ${AITO_BLOCK_NAME} before delete"
    restcurl -X PATCH "/shared/iapp/blocks/${block_id}" -d '{"state":"UNBINDING"}' >/var/tmp/${AITO_APP_NAME}.block.unbind.response.json || true
    for attempt in $(seq 1 30); do
      state="$(get_iapp_block_state_by_id "${block_id}")"
      [[ "${state}" == "UNBOUND" ]] && break
      sleep 1
    done
  fi

  log "Deleting iApps LX block ${AITO_BLOCK_NAME} (${block_id})"
  restcurl -X DELETE "/shared/iapp/blocks/${block_id}" >/var/tmp/${AITO_APP_NAME}.block.delete.response.json || true
}

get_loader_path_config_json() {
  restcurl "/shared/nodejs/loader-path-config" 2>/dev/null || true
}

get_loader_path_config_id() {
  awk -v expected="${APP_WORKER_DIR}" '
    /"id"[[:space:]]*:[[:space:]]*"/ {
      line = $0
      sub(/^.*"id"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      current_id = line
    }
    /"workerPath"[[:space:]]*:[[:space:]]*"/ {
      line = $0
      sub(/^.*"workerPath"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      if (line == expected) {
        print current_id
        exit
      }
    }
  ' <<< "$(get_loader_path_config_json)"
}

register_worker_loader_path() {
  local loader_id
  local payload

  restcurl_required
  loader_id="$(get_loader_path_config_id)"
  if [[ -n "${loader_id}" ]]; then
    log "Worker loader path already registered: ${APP_WORKER_DIR}"
    return 0
  fi

  log "Registering worker loader path: ${APP_WORKER_DIR}"
  payload="{\"workerPath\":\"${APP_WORKER_DIR}\"}"
  restcurl -X POST "/shared/nodejs/loader-path-config" -d "${payload}" >/var/tmp/${AITO_APP_NAME}.loader-path.response.json
}

delete_worker_loader_path_if_exists() {
  local loader_id

  restcurl_required
  loader_id="$(get_loader_path_config_id)"
  [[ -n "${loader_id}" ]] || return 0

  log "Deleting worker loader path ${APP_WORKER_DIR} (${loader_id})"
  restcurl -X DELETE "/shared/nodejs/loader-path-config/${loader_id}" >/var/tmp/${AITO_APP_NAME}.loader-path.delete.response.json || true
}

install_sudoers_bridge() {
  cat > "${SUDOERS_FILE}" <<EOF
restnoded ALL=(root) NOPASSWD: /bin/bash ${APP_DIR}/nodejs/apply_config_root.sh *
EOF
  chmod 440 "${SUDOERS_FILE}"
}

restart_restnoded() {
  log "Restarting restnoded"
  bigstart restart restnoded
}

wait_worker_registration() {
  local code
  local attempt

  for attempt in $(seq 1 60); do
    code="$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost/mgmt/iapps/${AITO_APP_NAME}" || true)"
    if [[ "${code}" == "200" || "${code}" == "401" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

restart_ilx_plugin() {
  if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
    log "Restarting ILX plugin ${ILX_PLUGIN}"
    tmsh modify ilx plugin "${ILX_PLUGIN}" disabled
    sleep 1
    tmsh modify ilx plugin "${ILX_PLUGIN}" enabled
  fi
}

latest_backup_dir() {
  if [[ ! -d "${BACKUP_ROOT}" ]]; then
    return 0
  fi
  find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | LC_ALL=C sort | tail -1
}
