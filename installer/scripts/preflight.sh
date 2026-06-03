#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

check_command() {
  local command_name="$1"

  have "${command_name}" || die "Required command not found: ${command_name}"
}

check_payload() {
  local relative_path="$1"

  [[ -e "${BUNDLE_ROOT}/${relative_path}" ]] || die "Missing payload path: ${relative_path}"
}

main() {
  require_root

  log "Running AITO offline installer preflight for version ${AITO_VERSION}"

  check_command bash
  check_command tar
  check_command find
  check_command sed
  check_command awk
  check_command grep
  check_command cp
  check_command chmod
  check_command chown
  check_command mkdir
  check_command rm
  check_command install
  check_command id
  check_command curl
  check_command tmsh
  check_command bigstart
  check_command restcurl

  ensure_runtime_user

  check_payload manifest.json
  check_payload SHA256SUMS
  check_payload payload/iapp/nodejs/index.js
  check_payload payload/iapp/presentation/index.html
  check_payload payload/iapp/presentation/app.js
  check_payload payload/iapp/nodejs/apply_config_root.sh
  check_payload payload/ilx/index.js
  check_payload payload/ilx/package.json
  check_payload payload/ilx/llm_semantic_route.tcl
  check_payload payload/ilx/classifier-config.json.seed
  check_payload payload/ilx/native/ifile_ai_gateway_classifiers.json
  check_payload payload/ilx/native/ifile_ai_gateway_backend_targets.json
  check_payload payload/ilx/native/ifile_ai_gateway_routing_policies.json
  check_payload payload/ilx/native/ifile_ai_gateway_config_snapshot.json
  check_payload payload/config/empty-deployed-config.json

  verify_bundle_checksums

  tmsh -q -c 'show sys version' >/dev/null
  tmsh -q -c 'list ilx workspace one-line' >/dev/null || die "Unable to list ILX workspaces. Check iRules LX support."
  restcurl "/shared/iapp/blocks?\$filter=name+eq+%27${AITO_BLOCK_NAME}%27" >/dev/null
  restcurl "/shared/nodejs/loader-path-config" >/dev/null

  [[ -d /var/config/rest/iapps ]] || die "Missing /var/config/rest/iapps"
  [[ -d /var/ilx/workspaces ]] || die "Missing /var/ilx/workspaces"
  [[ -w /var/tmp ]] || die "/var/tmp is not writable"

  if tmsh_has '^ilx plugin ' list ilx plugin "${ILX_PLUGIN}"; then
    log "Existing ILX plugin found: ${ILX_PLUGIN}"
  else
    log "ILX plugin will be created: ${ILX_PLUGIN}"
  fi

  if [[ -d "${APP_DIR}" ]]; then
    log "Existing iApps LX app directory will be backed up and replaced: ${APP_DIR}"
  else
    log "iApps LX app directory will be created: ${APP_DIR}"
  fi

  log "Preflight passed"
}

main "$@"
