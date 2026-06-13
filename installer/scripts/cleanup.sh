#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

delete_tmsh_object_if_exists() {
  local object_type="$1"
  local object_name="$2"
  local display_name="$3"

  if tmsh_has "^${object_type} " list ${object_type} "${object_name}"; then
    log "Deleting ${display_name}: ${object_name}"
    tmsh delete ${object_type} "${object_name}" || warn "Unable to delete ${display_name}: ${object_name}"
  fi
}

delete_classifier_egress_virtuals() {
  local virtual_name
  local virtuals

  virtuals="$(
    tmsh -q -c 'cd /; list ltm virtual recursive one-line' 2>/dev/null |
      awk '$1 == "ltm" && $2 == "virtual" && (index($3, "/Common/aito_cls_egress_") == 1 || index($3, "aito_cls_egress_") == 1) { print $3 }'
  )"

  while IFS= read -r virtual_name; do
    [[ -n "${virtual_name}" ]] || continue
    log "Deleting classifier egress virtual: ${virtual_name}"
    tmsh delete ltm virtual "${virtual_name}" || warn "Unable to delete classifier egress virtual: ${virtual_name}"
  done <<< "${virtuals}"
}

delete_aito_data_groups() {
  local object_name

  for object_name in \
    /Common/dg_ai_gateway_listener_refs \
    /Common/dg_ai_gateway_listener_settings \
    /Common/dg_ai_gateway_virtual_keys \
    /Common/dg_ai_gateway_virtual_key_pools \
    /Common/dg_ai_gateway_listener_vk_pool_allowlist \
    /Common/dg_ai_gateway_classifier_egress_settings; do
    delete_tmsh_object_if_exists "ltm data-group internal" "${object_name}" "data group"
  done
}

delete_aito_ifiles() {
  local object_name

  for object_name in \
    /Common/ifile_ai_gateway_classifiers \
    /Common/ifile_ai_gateway_backend_targets \
    /Common/ifile_ai_gateway_provider_credential_pools \
    /Common/ifile_ai_gateway_routing_policies \
    /Common/ifile_ai_gateway_config_snapshot; do
    delete_tmsh_object_if_exists "sys file ifile" "${object_name}" "iFile"
  done
}

delete_ilx_plugin_if_exists() {
  if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
    log "Deleting ILX plugin: ${ILX_PLUGIN}"
    tmsh modify ilx plugin "${ILX_PLUGIN}" disabled || true
    tmsh delete ilx plugin "${ILX_PLUGIN}" ||
      tmsh delete ilx plugin "${ILX_PLUGIN}" recursive ||
      warn "Unable to delete ILX plugin: ${ILX_PLUGIN}"
  fi
}

delete_ilx_workspace_if_exists() {
  if tmsh_has '^ilx workspace ' list ilx workspace "${ILX_WORKSPACE}"; then
    log "Deleting ILX workspace: ${ILX_WORKSPACE}"
    tmsh delete ilx workspace "${ILX_WORKSPACE}" || warn "Unable to delete ILX workspace: ${ILX_WORKSPACE}"
  fi
}

delete_files() {
  log "Deleting AITO filesystem paths"
  rm -rf "${APP_DIR}" "${RUNTIME_DIR}"
  rm -f "${SUDOERS_FILE}"
  rm -f \
    "/var/tmp/${AITO_APP_NAME}.block.json" \
    "/var/tmp/${AITO_APP_NAME}.block.response.json" \
    "/var/tmp/${AITO_APP_NAME}.block.unbind.response.json" \
    "/var/tmp/${AITO_APP_NAME}.block.delete.response.json" \
    "/var/tmp/${AITO_APP_NAME}.loader-path.response.json" \
    "/var/tmp/${AITO_APP_NAME}.loader-path.delete.response.json" \
    "/var/tmp/${AITO_IRULE_NAME}.install.conf" \
    /var/tmp/aito_classifier_egress.conf
}

main() {
  require_root

  log "Cleaning AITO environment"

  delete_iapp_block_if_exists
  delete_worker_loader_path_if_exists
  delete_classifier_egress_virtuals
  delete_tmsh_object_if_exists "ltm rule" "/Common/aito_classifier_egress" "classifier egress iRule"
  delete_aito_data_groups
  delete_aito_ifiles
  delete_tmsh_object_if_exists "ltm profile server-ssl" "/Common/aito_managed_serverssl" "managed server SSL profile"
  delete_tmsh_object_if_exists "ltm rule" "${ILX_IRULE}" "AITO iRule"
  delete_ilx_plugin_if_exists
  delete_ilx_workspace_if_exists
  delete_files

  tmsh save sys config || warn "tmsh save failed during cleanup"
  restart_restnoded || warn "restnoded restart failed during cleanup"

  log "AITO environment cleanup complete"
}

main "$@"
