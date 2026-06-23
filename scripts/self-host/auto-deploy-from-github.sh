#!/usr/bin/env bash
set -euo pipefail

# Minimal VM-owned auto deploy loop for the first OVH live test.
# Production hardening target remains: GHCR digest + manifest verification + deployd/Kamal.
# Do not put secrets in this script; runtime secrets live on the VM under BORING_APP_DIR.

BRANCH="${BORING_DEPLOY_BRANCH:-plan/self-host-vm-boring}"
REPO="${BORING_DEPLOY_REPO:-https://github.com/hachej/boring-ui.git}"
APP_DIR="${BORING_APP_DIR:-/opt/boring/full-app}"
SOURCE_DIR="${BORING_SOURCE_DIR:-${APP_DIR}/github-source}"
LOCK_FILE="${BORING_DEPLOY_LOCK_FILE:-/run/boring-auto-deploy.lock}"
LAST_REVISION_FILE="${BORING_LAST_REVISION_FILE:-${APP_DIR}/last-deployed-revision}"
IMAGE="${BORING_IMAGE:-boring-full-app:self-host-test}"
SECRETS_DB_ENV="${BORING_DB_ENV_FILE:-${APP_DIR}/../secrets/db.env}"
APP_ENV_FILE="${BORING_APP_ENV_FILE:-${APP_DIR}/.env}"
HEALTH_URL="${BORING_HEALTH_URL:-http://127.0.0.1:3000/health}"

exec 9>"${LOCK_FILE}"
flock -n 9 || exit 0

mkdir -p "${APP_DIR}"

if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  rm -rf "${SOURCE_DIR}"
  git clone --branch "${BRANCH}" --single-branch "${REPO}" "${SOURCE_DIR}"
else
  git -C "${SOURCE_DIR}" fetch origin "${BRANCH}"
  git -C "${SOURCE_DIR}" checkout -f "${BRANCH}"
  git -C "${SOURCE_DIR}" reset --hard "origin/${BRANCH}"
fi

revision="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
if [[ -f "${LAST_REVISION_FILE}" ]] && [[ "$(cat "${LAST_REVISION_FILE}")" == "${revision}" ]]; then
  echo "already deployed ${revision}"
  exit 0
fi

cd "${SOURCE_DIR}"
docker build \
  --file apps/full-app/Dockerfile \
  --target web-runtime \
  --build-arg "REVISION=${revision}" \
  --build-arg "SOURCE=${REPO}" \
  --tag "${IMAGE}" \
  .

# shellcheck disable=SC1090
. "${SECRETS_DB_ENV}"
docker run --rm \
  --env-file "${APP_ENV_FILE}" \
  -e "DATABASE_URL=${DATABASE_MIGRATION_URL}" \
  "${IMAGE}" \
  node apps/full-app/dist/server/migrate.js

cd "${APP_DIR}"
docker compose up -d --force-recreate

for _ in $(seq 1 60); do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    echo "${revision}" > "${LAST_REVISION_FILE}"
    echo "deployed ${revision}"
    exit 0
  fi
  sleep 2
done

docker logs --tail=200 full-app-web-1 || true
echo "health check failed" >&2
exit 1
