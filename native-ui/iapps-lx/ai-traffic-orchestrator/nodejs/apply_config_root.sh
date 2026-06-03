#!/bin/bash
set -euo pipefail

SCRIPT_PATH="${1:-}"
RUNTIME_ROOT="/var/tmp/AITrafficOrchestrator-runtime"

if [[ -z "${SCRIPT_PATH}" ]]; then
  echo "Usage: $0 <apply-script-path>" >&2
  exit 2
fi

case "${SCRIPT_PATH}" in
  "${RUNTIME_ROOT}"/*.sh) ;;
  *)
    echo "Refusing to execute script outside ${RUNTIME_ROOT}: ${SCRIPT_PATH}" >&2
    exit 2
    ;;
esac

if [[ ! -f "${SCRIPT_PATH}" ]]; then
  echo "Apply script not found: ${SCRIPT_PATH}" >&2
  exit 2
fi

exec /bin/bash "${SCRIPT_PATH}"
