#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

restore_tmsh_file() {
  local file="$1"

  if [[ -f "${file}" ]]; then
    tmsh load sys config merge file "${file}" || warn "Unable to merge ${file}"
  fi
}

main() {
  local backup_dir="${1:-}"

  require_root

  if [[ -z "${backup_dir}" ]]; then
    backup_dir="$(latest_backup_dir)"
  fi
  [[ -n "${backup_dir}" ]] || die "No backup directory found under ${BACKUP_ROOT}"
  [[ -f "${backup_dir}/state.env" ]] || die "Backup state file missing: ${backup_dir}/state.env"

  # shellcheck disable=SC1090
  source "${backup_dir}/state.env"

  log "Rolling back AITO using ${backup_dir}"

  if [[ "${existed_app_dir:-0}" == "1" ]]; then
    copy_tree "${backup_dir}/files/iapp" "${APP_DIR}"
  else
    rm -rf "${APP_DIR}"
  fi

  if [[ "${existed_ilx_extension_dir:-0}" == "1" ]]; then
    copy_tree "${backup_dir}/files/ilx_extension" "${ILX_EXTENSION_DIR}"
  else
    rm -rf "${ILX_EXTENSION_DIR}"
  fi

  mkdir -p "${RUNTIME_DIR}"
  if [[ "${existed_deployed_config:-0}" == "1" ]]; then
    install -m 0644 "${backup_dir}/files/runtime/deployed-config.json" "${DEPLOYED_CONFIG_FILE}"
    set_runtime_permissions
  else
    rm -f "${DEPLOYED_CONFIG_FILE}"
  fi

  if [[ "${existed_sudoers:-0}" == "1" ]]; then
    install -m 0440 "${backup_dir}/files/sudoers" "${SUDOERS_FILE}"
  else
    rm -f "${SUDOERS_FILE}"
  fi

  if [[ "${existed_iapp_block:-0}" == "0" ]]; then
    delete_iapp_block_if_exists
  else
    log "Preserving existing iApps LX block ${AITO_BLOCK_NAME}; code and runtime files were restored from backup"
  fi

  if [[ "${existed_loader_path:-0}" == "0" ]]; then
    delete_worker_loader_path_if_exists
  else
    log "Preserving existing worker loader path ${APP_WORKER_DIR}"
  fi

  if [[ "${existed_irule:-0}" == "1" ]]; then
    restore_tmsh_file "${backup_dir}/tmsh/irule.conf"
  else
    if tmsh_has '^ltm rule ' list ltm rule "${ILX_IRULE}"; then
      tmsh delete ltm rule "${ILX_IRULE}" || warn "Unable to delete ${ILX_IRULE}"
    fi
  fi

  if [[ "${existed_plugin:-0}" == "1" ]]; then
    restore_tmsh_file "${backup_dir}/tmsh/ilx_plugin.conf"
    if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
      tmsh modify ilx plugin "${ILX_PLUGIN}" from-workspace "${ILX_WORKSPACE}" || true
    fi
  else
    if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
      tmsh delete ilx plugin "${ILX_PLUGIN}" recursive || warn "Unable to delete ${ILX_PLUGIN}"
    fi
  fi

  if [[ "${existed_workspace:-0}" == "1" ]]; then
    restore_tmsh_file "${backup_dir}/tmsh/ilx_workspace.conf"
  else
    if tmsh_has '^ilx workspace ' list ilx workspace "${ILX_WORKSPACE}"; then
      tmsh delete ilx workspace "${ILX_WORKSPACE}" || warn "Unable to delete ${ILX_WORKSPACE}"
    fi
  fi

  if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
    restart_ilx_plugin
  fi

  tmsh save sys config || warn "tmsh save failed during rollback"
  restart_restnoded || warn "restnoded restart failed during rollback"

  log "Rollback complete"
}

main "$@"
