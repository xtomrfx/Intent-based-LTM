#!/usr/bin/env bash
set -euo pipefail

export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_SRC="${REPO_ROOT}/native-ui/iapps-lx/ai-traffic-orchestrator"
APP_PACKAGE="${APP_SRC}/package.json"
ROOT_PACKAGE="${REPO_ROOT}/package.json"
DIST_DIR="${DIST_DIR:-${REPO_ROOT}/dist}"

if [[ ! -d "${APP_SRC}" ]]; then
  echo "iApps LX source not found: ${APP_SRC}" >&2
  exit 1
fi

APP_VERSION="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${APP_PACKAGE}" | head -1
)"

if [[ -z "${APP_VERSION}" ]]; then
  echo "Unable to read version from ${APP_PACKAGE}" >&2
  exit 1
fi

BUNDLE_NAME="${BUNDLE_NAME:-aito-${APP_VERSION}}"
STAGE_DIR="${DIST_DIR}/${BUNDLE_NAME}"
ARCHIVE_PATH="${DIST_DIR}/${BUNDLE_NAME}.tgz"
TAR_PATH="${DIST_DIR}/${BUNDLE_NAME}.tar"
BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
TAR_METADATA_ARGS=()

if tar --no-xattrs -cf /tmp/aito-tar-capability-check.tar --files-from /dev/null >/dev/null 2>&1; then
  TAR_METADATA_ARGS+=(--no-xattrs)
fi
rm -f /tmp/aito-tar-capability-check.tar

copy_tree() {
  local source_dir="$1"
  local target_dir="$2"

  mkdir -p "${target_dir}"
  (
    cd "${source_dir}"
    tar \
      "${TAR_METADATA_ARGS[@]}" \
      --exclude '._*' \
      --exclude '.DS_Store' \
      --exclude '__MACOSX' \
      -cf - .
  ) | (
    cd "${target_dir}"
    tar -xf -
  )
}

strip_extended_attributes() {
  local target_dir="$1"

  if command -v xattr >/dev/null 2>&1; then
    xattr -rc "${target_dir}" 2>/dev/null || true
  fi
}

write_root_wrapper() {
  local name="$1"
  local target="${STAGE_DIR}/${name}"

  cat > "${target}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "\${SCRIPT_DIR}/scripts/${name}" "\$@"
EOF
  chmod 755 "${target}"
}

rm -rf "${STAGE_DIR}" "${ARCHIVE_PATH}" "${ARCHIVE_PATH}.sha256" "${TAR_PATH}" "${TAR_PATH}.sha256"
mkdir -p \
  "${STAGE_DIR}/scripts" \
  "${STAGE_DIR}/payload/iapp" \
  "${STAGE_DIR}/payload/ilx/native" \
  "${STAGE_DIR}/payload/config" \
  "${STAGE_DIR}/payload/tmsh"

copy_tree "${APP_SRC}" "${STAGE_DIR}/payload/iapp"
install -m 0644 "${REPO_ROOT}/index.js" "${STAGE_DIR}/payload/ilx/index.js"
install -m 0644 "${ROOT_PACKAGE}" "${STAGE_DIR}/payload/ilx/package.json"
install -m 0644 "${REPO_ROOT}/llm_semantic_route.tcl" "${STAGE_DIR}/payload/ilx/llm_semantic_route.tcl"
install -m 0644 "${REPO_ROOT}/classifier-config.json.example" "${STAGE_DIR}/payload/ilx/classifier-config.json.seed"
install -m 0644 "${APP_SRC}/presentation/data/sample-config.json" "${STAGE_DIR}/payload/config/sample-config.json"
copy_tree "${SCRIPT_DIR}/scripts" "${STAGE_DIR}/scripts"
chmod 755 "${STAGE_DIR}/scripts/"*.sh

cat > "${STAGE_DIR}/payload/config/empty-deployed-config.json" <<'EOF'
{
  "operatingMode": "gateway",
  "listeners": {},
  "classifiers": {},
  "backendTargets": {},
  "providerCredentialPools": {},
  "routingPolicies": {},
  "virtualKeyPools": {},
  "virtualKeys": {},
  "activeIds": {
    "listener": "",
    "classifier": "",
    "backend": "",
    "policy": "",
    "ruleIndex": 0
  },
  "ui": {
    "listenerEditorMode": "empty",
    "backendEditorMode": "empty",
    "policyEditorMode": "empty",
    "classifierEditorMode": "empty"
  },
  "meta": {
    "source": "deployed",
    "dirty": false
  }
}
EOF

node - "${REPO_ROOT}" "${STAGE_DIR}/payload/config/empty-deployed-config.json" "${STAGE_DIR}/payload/ilx/native" <<'NODE'
const fs = require('fs');
const path = require('path');

const repoRoot = process.argv[2];
const blockPath = process.argv[3];
const outputDir = process.argv[4];
const configProcessor = require(path.join(repoRoot, 'native-ui/iapps-lx/ai-traffic-orchestrator/nodejs/configProcessor'));
const block = JSON.parse(fs.readFileSync(blockPath, 'utf8'));
const artifacts = configProcessor.buildArtifacts(configProcessor.normalizeBlock(block));
const mapping = {
  classifiers: 'ifile_ai_gateway_classifiers.json',
  backend_targets: 'ifile_ai_gateway_backend_targets.json',
  provider_credential_pools: 'ifile_ai_gateway_provider_credential_pools.json',
  routing_policies: 'ifile_ai_gateway_routing_policies.json',
  config_snapshot: 'ifile_ai_gateway_config_snapshot.json'
};

Object.keys(mapping).forEach((key) => {
  fs.writeFileSync(
    path.join(outputDir, mapping[key]),
    JSON.stringify(artifacts.ifiles[key].content, null, 2) + '\n',
    'utf8'
  );
});
NODE

cat > "${STAGE_DIR}/payload/tmsh/README.txt" <<'EOF'
This directory is reserved for future static tmsh bootstrap fragments.
V1 generates the iRule wrapper and iApp block payload dynamically from scripts
so package metadata stays consistent with the manifest.
EOF

cat > "${STAGE_DIR}/manifest.json" <<EOF
{
  "schema": "f5-aito-offline-installer/v1",
  "product": "AI Traffic Orchestrator",
  "app_name": "AITrafficOrchestrator",
  "block_name": "AITrafficOrchestrator",
  "version": "${APP_VERSION}",
  "built_at_utc": "${BUILD_TIME}",
  "runtime": {
    "ilx_workspace": "/Common/llm_semantic_ws",
    "ilx_extension": "llm_semantic_ext",
    "ilx_plugin": "/Common/llm_semantic_plugin",
    "irule": "/Common/llm_semantic_route_phase2"
  },
  "install_paths": {
    "iapp": "/var/config/rest/iapps/AITrafficOrchestrator",
    "runtime": "/var/tmp/AITrafficOrchestrator-runtime",
    "ilx_extension": "/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext"
  },
  "offline": true
}
EOF

cat > "${STAGE_DIR}/README.txt" <<EOF
AI Traffic Orchestrator offline installer ${APP_VERSION}

Upload this directory or ${BUNDLE_NAME}.tgz to a BIG-IP device, then run:

  sudo ./oneclick_install.sh

To remove AITO-owned objects from a lab or clean test device:

  sudo ./oneclick_uninstall.sh

V1 installs the AITO control plane, ILX runtime, iRule, and an empty deployed
configuration baseline. It does not create a traffic listener by default.
Create listeners, backend targets, classifiers, and routing policies from the
TMUI AITO page, then use Deploy Changes.
EOF

write_root_wrapper "preflight.sh"
write_root_wrapper "install.sh"
write_root_wrapper "upgrade.sh"
write_root_wrapper "rollback.sh"
write_root_wrapper "verify.sh"
write_root_wrapper "cleanup.sh"
write_root_wrapper "oneclick_install.sh"
write_root_wrapper "oneclick_uninstall.sh"
strip_extended_attributes "${STAGE_DIR}"

(
  cd "${STAGE_DIR}"
  find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | while IFS= read -r file; do
    shasum -a 256 "${file}"
  done > SHA256SUMS
)

mkdir -p "${DIST_DIR}"
(
  cd "${DIST_DIR}"
  tar "${TAR_METADATA_ARGS[@]}" --exclude '._*' --exclude '.DS_Store' -cf "${TAR_PATH}" "${BUNDLE_NAME}"
  shasum -a 256 "${TAR_PATH}" > "${TAR_PATH}.sha256"
  tar "${TAR_METADATA_ARGS[@]}" --exclude '._*' --exclude '.DS_Store' -czf "${ARCHIVE_PATH}" "${BUNDLE_NAME}"
  shasum -a 256 "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
)

cat <<EOF
Built offline installer:
  ${ARCHIVE_PATH}
  ${TAR_PATH}
Checksum:
  ${ARCHIVE_PATH}.sha256
  ${TAR_PATH}.sha256
Unpacked staging directory:
  ${STAGE_DIR}
EOF
