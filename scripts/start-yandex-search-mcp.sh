#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${YANDEX_SEARCH_API_KEY:-}" ]]; then
  echo "YANDEX_SEARCH_API_KEY is not set" >&2
  exit 1
fi

if [[ -z "${YANDEX_SEARCH_FOLDER_ID:-}" ]]; then
  echo "YANDEX_SEARCH_FOLDER_ID is not set" >&2
  exit 1
fi

exec npx -y mcp-remote \
  "https://d5de9siimt9bkld7viic.emzafcgx.apigw.yandexcloud.net:3000/sse" \
  --header "ApiKey:${YANDEX_SEARCH_API_KEY}" \
  --header "FolderId:${YANDEX_SEARCH_FOLDER_ID}"
