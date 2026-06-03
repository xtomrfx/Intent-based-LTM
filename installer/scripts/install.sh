#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

BACKUP_DIR=""

write_state_value() {
  local key="$1"
  local value="$2"

  printf '%s=%q\n' "${key}" "${value}" >> "${BACKUP_DIR}/state.env"
}

backup_tmsh_object() {
  local label="$1"
  local object_type="$2"
  local object_name="$3"
  local exists_key="$4"
  local output_file="${BACKUP_DIR}/tmsh/${label}.conf"

  if tmsh_has "^${object_type} " list ${object_type} "${object_name}"; then
    write_state_value "${exists_key}" "1"
    tmsh list ${object_type} "${object_name}" > "${output_file}"
  else
    write_state_value "${exists_key}" "0"
  fi
}

backup_current_state() {
  local timestamp

  timestamp="$(date -u '+%Y%m%d%H%M%S')"
  BACKUP_DIR="${BACKUP_ROOT}/${timestamp}"
  mkdir -p "${BACKUP_DIR}/files" "${BACKUP_DIR}/tmsh"
  : > "${BACKUP_DIR}/state.env"

  write_state_value "backup_created_at_utc" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  write_state_value "version" "${AITO_VERSION}"
  write_state_value "app_dir" "${APP_DIR}"
  write_state_value "app_worker_dir" "${APP_WORKER_DIR}"
  write_state_value "ilx_extension_dir" "${ILX_EXTENSION_DIR}"
  write_state_value "runtime_dir" "${RUNTIME_DIR}"

  if [[ -d "${APP_DIR}" ]]; then
    write_state_value "existed_app_dir" "1"
    copy_tree "${APP_DIR}" "${BACKUP_DIR}/files/iapp"
  else
    write_state_value "existed_app_dir" "0"
  fi

  if [[ -d "${ILX_EXTENSION_DIR}" ]]; then
    write_state_value "existed_ilx_extension_dir" "1"
    copy_tree "${ILX_EXTENSION_DIR}" "${BACKUP_DIR}/files/ilx_extension"
  else
    write_state_value "existed_ilx_extension_dir" "0"
  fi

  if [[ -f "${DEPLOYED_CONFIG_FILE}" ]]; then
    write_state_value "existed_deployed_config" "1"
    mkdir -p "${BACKUP_DIR}/files/runtime"
    install -m 0644 "${DEPLOYED_CONFIG_FILE}" "${BACKUP_DIR}/files/runtime/deployed-config.json"
  else
    write_state_value "existed_deployed_config" "0"
  fi

  if [[ -f "${SUDOERS_FILE}" ]]; then
    write_state_value "existed_sudoers" "1"
    install -m 0440 "${SUDOERS_FILE}" "${BACKUP_DIR}/files/sudoers"
  else
    write_state_value "existed_sudoers" "0"
  fi

  backup_tmsh_object "ilx_workspace" "ilx workspace" "${ILX_WORKSPACE}" "existed_workspace"
  backup_tmsh_object "ilx_plugin" "ilx plugin" "${ILX_PLUGIN}" "existed_plugin"
  backup_tmsh_object "irule" "ltm rule" "${ILX_IRULE}" "existed_irule"

  get_iapp_block_json > "${BACKUP_DIR}/iapp-block.json" 2>/dev/null || true
  if grep -q "\"name\"[[:space:]]*:[[:space:]]*\"${AITO_BLOCK_NAME}\"" "${BACKUP_DIR}/iapp-block.json"; then
    write_state_value "existed_iapp_block" "1"
  else
    write_state_value "existed_iapp_block" "0"
  fi

  get_loader_path_config_json > "${BACKUP_DIR}/loader-path-config.json" 2>/dev/null || true
  if [[ -n "$(get_loader_path_config_id)" ]]; then
    write_state_value "existed_loader_path" "1"
  else
    write_state_value "existed_loader_path" "0"
  fi

  log "Backup written to ${BACKUP_DIR}"
}

install_iapp_payload() {
  log "Installing iApps LX app to ${APP_DIR}"
  copy_tree "${PAYLOAD_DIR}/iapp" "${APP_DIR}"
  find "${APP_DIR}" -name '._*' -delete
  find "${APP_DIR}" -name '.DS_Store' -delete
  find "${APP_DIR}" -type d -exec chmod 755 {} +
  find "${APP_DIR}" -type f -exec chmod 644 {} +
  chmod 755 "${APP_DIR}/nodejs/apply_config_root.sh"
  chown -R root:root "${APP_DIR}"
}

bootstrap_ilx_workspace() {
  if ! tmsh_has '^ilx workspace ' list ilx workspace "${ILX_WORKSPACE}"; then
    log "Creating ILX workspace ${ILX_WORKSPACE}"
    tmsh create ilx workspace "${ILX_WORKSPACE}"
  fi

  if [[ ! -d "${ILX_EXTENSION_DIR}" ]]; then
    log "Creating ILX extension ${AITO_EXTENSION_NAME}"
    tmsh create ilx workspace "${ILX_WORKSPACE}" extension "${AITO_EXTENSION_NAME}"
  fi

  mkdir -p "${ILX_NATIVE_DIR}"
}

install_ilx_payload() {
  local source_file
  local target_file

  log "Installing ILX runtime to ${ILX_EXTENSION_DIR}"
  install -m 0644 "${PAYLOAD_DIR}/ilx/index.js" "${ILX_EXTENSION_DIR}/index.js"
  install -m 0644 "${PAYLOAD_DIR}/ilx/package.json" "${ILX_EXTENSION_DIR}/package.json"

  if [[ ! -f "${ILX_EXTENSION_DIR}/classifier-config.json" ]]; then
    install -m 0644 "${PAYLOAD_DIR}/ilx/classifier-config.json.seed" "${ILX_EXTENSION_DIR}/classifier-config.json"
  else
    log "Preserving existing classifier-config.json"
  fi

  mkdir -p "${ILX_NATIVE_DIR}" "${RUNTIME_DIR}"

  for source_file in "${PAYLOAD_DIR}/ilx/native/"*.json; do
    target_file="${ILX_NATIVE_DIR}/$(basename "${source_file}")"
    if [[ ! -f "${target_file}" ]]; then
      install -m 0644 "${source_file}" "${target_file}"
    else
      log "Preserving existing native runtime file ${target_file}"
    fi

    target_file="${RUNTIME_DIR}/$(basename "${source_file}")"
    if [[ ! -f "${target_file}" ]]; then
      install -m 0644 "${source_file}" "${target_file}"
    fi
  done

  if [[ ! -f "${DEPLOYED_CONFIG_FILE}" ]]; then
    install -m 0644 "${PAYLOAD_DIR}/config/empty-deployed-config.json" "${DEPLOYED_CONFIG_FILE}"
  else
    log "Preserving existing deployed-config.json"
  fi

  chown -R root:root "${ILX_EXTENSION_DIR}"
  chgrp sdm "${ILX_EXTENSION_DIR}" 2>/dev/null || true
  chmod 775 "${ILX_EXTENSION_DIR}" || true
  set_runtime_permissions
}

install_irule() {
  local irule_conf="/var/tmp/${AITO_IRULE_NAME}.install.conf"

  log "Installing iRule ${ILX_IRULE}"
  {
    printf 'ltm rule %s {\n' "${ILX_IRULE}"
    sed 's/^/    /' "${PAYLOAD_DIR}/ilx/llm_semantic_route.tcl"
    printf '}\n'
  } > "${irule_conf}"
  tmsh load sys config merge file "${irule_conf}"
}

publish_ilx_plugin() {
  if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
    log "Publishing existing ILX plugin from workspace"
    tmsh modify ilx plugin "${ILX_PLUGIN}" from-workspace "${ILX_WORKSPACE}"
  else
    log "Creating ILX plugin ${ILX_PLUGIN}"
    tmsh create ilx plugin "${ILX_PLUGIN}" from-workspace "${ILX_WORKSPACE}"
  fi
  restart_ilx_plugin
}

main() {
  require_root

  "${SCRIPT_DIR}/preflight.sh"
  backup_current_state
  install_iapp_payload
  install_sudoers_bridge
  register_worker_loader_path
  bootstrap_ilx_workspace
  install_ilx_payload
  install_irule
  publish_ilx_plugin
  register_iapp_block
  tmsh save sys config
  restart_restnoded

  if ! wait_worker_registration; then
    warn "AITO worker did not return HTTP 200/401 within the wait window. Run ./verify.sh after restnoded settles."
  fi

  log "AITO offline install complete"
  log "Backup directory: ${BACKUP_DIR}"
  log "TMUI worker entry: https://<BIG-IP>/mgmt/iapps/${AITO_APP_NAME}"
  log "Static fallback: https://<BIG-IP>/iapps/${AITO_APP_NAME}/presentation/index.html"
}

main "$@"
