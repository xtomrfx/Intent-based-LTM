#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

main() {
  require_root

  log "Starting one-click AITO offline install for version ${AITO_VERSION}"
  "${SCRIPT_DIR}/preflight.sh"
  "${SCRIPT_DIR}/install.sh"
  "${SCRIPT_DIR}/verify.sh"
  log "One-click AITO offline install complete"
}

main "$@"
