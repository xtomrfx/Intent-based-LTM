#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS: %s\n' "$*"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'FAIL: %s\n' "$*" >&2
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  printf 'SKIP: %s\n' "$*"
}

check_file() {
  local file="$1"

  if [[ -f "${file}" ]]; then
    pass "file exists: ${file}"
  else
    fail "missing file: ${file}"
  fi
}

check_dir() {
  local dir="$1"

  if [[ -d "${dir}" ]]; then
    pass "directory exists: ${dir}"
  else
    fail "missing directory: ${dir}"
  fi
}

check_runtime_worker_access() {
  local probe="${RUNTIME_DIR}/verify-write-$$.tmp"
  local output

  if ! have su; then
    fail "su command missing; cannot verify ${AITO_RUNTIME_USER} runtime write access"
    return
  fi
  if ! id "${AITO_RUNTIME_USER}" >/dev/null 2>&1; then
    fail "runtime user missing: ${AITO_RUNTIME_USER}"
    return
  fi

  if output="$(
    su "${AITO_RUNTIME_USER}" -s /bin/bash -c "test -r '${DEPLOYED_CONFIG_FILE}' && umask 077 && : > '${probe}' && rm -f '${probe}'" 2>&1
  )"; then
    pass "runtime directory readable/writable by ${AITO_RUNTIME_USER}: ${RUNTIME_DIR}"
  else
    fail "runtime directory not readable/writable by ${AITO_RUNTIME_USER}: ${output}"
  fi
}

main() {
  local code
  local blocks_json
  local plugin_store_match

  require_root

  check_dir "${APP_DIR}"
  check_file "${APP_DIR}/presentation/index.html"
  check_file "${APP_DIR}/presentation/app.js"
  check_file "${APP_DIR}/presentation/styles.css"
  check_file "${APP_DIR}/nodejs/index.js"
  check_file "${APP_DIR}/nodejs/apply_config_root.sh"
  check_file "${SUDOERS_FILE}"

  check_dir "${ILX_EXTENSION_DIR}"
  check_file "${ILX_EXTENSION_DIR}/index.js"
  check_file "${ILX_EXTENSION_DIR}/package.json"
  check_file "${ILX_EXTENSION_DIR}/classifier-config.json"
  check_file "${ILX_NATIVE_DIR}/ifile_ai_gateway_classifiers.json"
  check_file "${ILX_NATIVE_DIR}/ifile_ai_gateway_backend_targets.json"
  check_file "${ILX_NATIVE_DIR}/ifile_ai_gateway_routing_policies.json"
  check_file "${ILX_NATIVE_DIR}/ifile_ai_gateway_config_snapshot.json"
  check_file "${DEPLOYED_CONFIG_FILE}"
  check_runtime_worker_access

  if tmsh_has '^ilx workspace ' list ilx workspace "${ILX_WORKSPACE}"; then
    pass "ILX workspace exists: ${ILX_WORKSPACE}"
  else
    fail "ILX workspace missing: ${ILX_WORKSPACE}"
  fi

  if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
    pass "ILX plugin exists: ${ILX_PLUGIN}"
  else
    fail "ILX plugin missing: ${ILX_PLUGIN}"
  fi

  if tmsh_has '^ltm rule ' list ltm rule "${ILX_IRULE}"; then
    pass "iRule exists: ${ILX_IRULE}"
  else
    fail "iRule missing: ${ILX_IRULE}"
  fi

  if [[ -n "$(get_loader_path_config_id)" ]]; then
    pass "worker loader path registered: ${APP_WORKER_DIR}"
  else
    fail "worker loader path missing: ${APP_WORKER_DIR}"
  fi

  plugin_store_match="$(find /var/sdm/plugin_store/plugins -path "*/extensions/${AITO_EXTENSION_NAME}/index.js" -print 2>/dev/null | head -1 || true)"
  if [[ -n "${plugin_store_match}" ]]; then
    pass "plugin_store extension published: ${plugin_store_match}"
  else
    fail "plugin_store extension not found for ${AITO_EXTENSION_NAME}"
  fi

  blocks_json="$(restcurl "/shared/iapp/blocks?\$filter=name+eq+%27${AITO_BLOCK_NAME}%27" 2>/dev/null || true)"
  if grep -q "\"name\"[[:space:]]*:[[:space:]]*\"${AITO_BLOCK_NAME}\"" <<< "${blocks_json}"; then
    pass "iApps LX block registered: ${AITO_BLOCK_NAME}"
  else
    fail "iApps LX block not registered: ${AITO_BLOCK_NAME}"
  fi

  code="$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost/mgmt/iapps/${AITO_APP_NAME}" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" ]]; then
    pass "worker endpoint registered: HTTP ${code}"
  else
    fail "worker endpoint not ready: HTTP ${code}"
  fi

  if [[ -n "${AITO_REST_USER:-}" && -n "${AITO_REST_PASSWORD:-}" ]]; then
    code="$(curl -sk -o /dev/null -w '%{http_code}' -u "${AITO_REST_USER}:${AITO_REST_PASSWORD}" "https://localhost/mgmt/iapps/${AITO_APP_NAME}/config" || true)"
    if [[ "${code}" == "200" ]]; then
      pass "config worker returned HTTP 200 with provided credentials"
    else
      fail "config worker returned HTTP ${code} with provided credentials"
    fi
  else
    skip "config worker authenticated check; set AITO_REST_USER and AITO_REST_PASSWORD to enable"
  fi

  printf '\nSummary: %s passed, %s failed, %s skipped\n' "${PASS_COUNT}" "${FAIL_COUNT}" "${SKIP_COUNT}"
  if [[ "${FAIL_COUNT}" -ne 0 ]]; then
    exit 1
  fi
}

main "$@"
