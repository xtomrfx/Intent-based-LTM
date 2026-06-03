#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running AITO V1 upgrade. This preserves deployed-config.json and existing native runtime JSON."
exec "${SCRIPT_DIR}/install.sh" "$@"
