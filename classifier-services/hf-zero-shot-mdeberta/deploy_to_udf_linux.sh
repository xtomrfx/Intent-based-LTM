#!/bin/bash
set -euo pipefail
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

TARGET_HOST="${TARGET_HOST:-}"
TARGET_PORT="${TARGET_PORT:-47003}"
TARGET_USER="${TARGET_USER:-ubuntu}"
HOST_PORT="${HOST_PORT:-18081}"
IMAGE_NAME="${IMAGE_NAME:-hf-zero-shot-mdeberta:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-hf-zero-shot-mdeberta}"
MODEL_ID="${MODEL_ID:-MoritzLaurer/mDeBERTa-v3-base-mnli-xnli}"
API_TOKEN="${API_TOKEN:-hf-zero-shot-demo-token}"
REMOTE_DIR="${REMOTE_DIR:-/home/${TARGET_USER}/hf-zero-shot-mdeberta}"
REMOTE_CACHE_DIR="${REMOTE_CACHE_DIR:-/home/${TARGET_USER}/hf-zero-shot-cache}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "${TARGET_PORT}")

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "${TARGET_HOST}" ]]; then
  echo "Set TARGET_HOST to the Linux host before deploying." >&2
  exit 1
fi

run_ssh() {
  set +e
  ssh "${SSH_OPTS[@]}" "${TARGET_USER}@${TARGET_HOST}" "$@"
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 && ${rc} -ne 255 ]]; then
    return "${rc}"
  fi
}

run_tar_copy() {
  set +e
  tar --exclude '._*' --exclude '.DS_Store' --exclude '__pycache__' --exclude '*.pyc' -C "${SCRIPT_DIR}" -cf - . | ssh "${SSH_OPTS[@]}" "${TARGET_USER}@${TARGET_HOST}" \
    "rm -rf '${REMOTE_DIR}' && mkdir -p '${REMOTE_DIR}' && tar -C '${REMOTE_DIR}' -xf -"
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 && ${rc} -ne 255 ]]; then
    return "${rc}"
  fi
}

run_tar_copy

run_ssh "
  set -euo pipefail
  mkdir -p '${REMOTE_CACHE_DIR}'
  cd '${REMOTE_DIR}'
  sudo docker build -t '${IMAGE_NAME}' .
  sudo docker rm -f '${CONTAINER_NAME}' >/dev/null 2>&1 || true
  sudo docker run -d \
    --name '${CONTAINER_NAME}' \
    --restart unless-stopped \
    -p '${HOST_PORT}:8000' \
    -e MODEL_ID='${MODEL_ID}' \
    -e API_TOKEN='${API_TOKEN}' \
    -e TORCH_NUM_THREADS='4' \
    -v '${REMOTE_CACHE_DIR}:/var/cache/huggingface' \
    '${IMAGE_NAME}'
"

echo "Waiting for classifier service on ${TARGET_HOST}:${HOST_PORT} ..."
run_ssh "
  set -euo pipefail
  for _ in \$(seq 1 60); do
    if curl -fsS http://127.0.0.1:${HOST_PORT}/healthz >/dev/null 2>&1; then
      curl -fsS http://127.0.0.1:${HOST_PORT}/healthz
      exit 0
    fi
    sleep 5
  done
  sudo docker logs '${CONTAINER_NAME}' --tail 200 >&2
  exit 1
"

echo
echo "AITO endpoint_url: http://10.1.1.9:${HOST_PORT}/classify"
echo "AITO API Key: ${API_TOKEN}"
echo "AITO classifier_type: classifier_nli"
echo "AITO schema_family: hf_zero_shot_classification"
