#!/usr/bin/env bash
# build_macro_bundle.sh — Build a deployable boring-macro bundle (tar.gz) for Sprite sandboxes.
#
# Usage:
#   bash deploy/sandbox/scripts/build_macro_bundle.sh [APP_ROOT]
#
# Env vars:
#   BORING_MACRO_ROOT — path to boring-macro repo (default: ../boring-macro relative to boring-ui)
#   BM_WHEEL_PATH     — optional prebuilt boring-macro wheel path.
#   BUNDLE_OUTPUT     — output path (default: /tmp/boring-macro-bundle.tar.gz)
#
# Output:
#   tar.gz with wheel + bootstrap script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BORING_UI_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

APP_ROOT="${1:-${BORING_MACRO_ROOT:-$(cd "${BORING_UI_ROOT}/../boring-macro" 2>/dev/null && pwd)}}"
BM_WHEEL_PATH="${BM_WHEEL_PATH:-}"
BUNDLE_OUTPUT="${BUNDLE_OUTPUT:-/tmp/boring-macro-bundle.tar.gz}"

if [[ -z "${APP_ROOT}" ]] || [[ ! -d "${APP_ROOT}" ]]; then
  echo "Error: boring-macro repo not found at ${APP_ROOT:-<unset>}"
  echo "Set BORING_MACRO_ROOT or pass as first argument."
  exit 1
fi

if [[ -z "${BM_WHEEL_PATH}" ]]; then
  BM_WHEEL_PATH="$(ls -1t "${APP_ROOT}"/dist/boring_macro-*.whl 2>/dev/null | head -1 || true)"
fi

if [[ -z "${BM_WHEEL_PATH}" ]]; then
  echo "Error: missing boring-macro wheel. Build one first with ./scripts/build_web_wheel.sh"
  exit 1
fi

if [[ ! -f "${BM_WHEEL_PATH}" ]]; then
  echo "Error: BM_WHEEL_PATH does not exist: ${BM_WHEEL_PATH}"
  exit 1
fi

echo "==> Building boring-macro bundle from ${APP_ROOT}"
echo "==> Using wheel: ${BM_WHEEL_PATH}"
echo "==> Output: ${BUNDLE_OUTPUT}"

WORK_DIR="$(mktemp -d /tmp/boring-macro-bundle.XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "[1/4] Staging wheel"
mkdir -p "${WORK_DIR}/wheels"
cp "${BM_WHEEL_PATH}" "${WORK_DIR}/wheels/"

echo "[2/4] Writing bootstrap.sh"
cat > "${WORK_DIR}/bootstrap.sh" <<'BOOTSTRAP'
#!/usr/bin/env bash
set -euo pipefail
cd /home/sprite/app

WHEEL_PATH="$(ls -1 /home/sprite/app/wheels/boring_macro-*.whl | head -1)"
if [[ -z "${WHEEL_PATH}" ]]; then
  echo "[bootstrap] Could not find boring_macro wheel under /home/sprite/app/wheels"
  exit 1
fi

echo "[bootstrap] Installing boring-macro wheel: ${WHEEL_PATH}"
pip install "${WHEEL_PATH}" 2>/dev/null || pip install --break-system-packages "${WHEEL_PATH}"

echo "[bootstrap] Creating app service"
# Clean up old two-service layouts from earlier releases.
if sprite-env services get companion >/dev/null 2>&1; then
  sprite-env services delete companion >/dev/null
fi
if sprite-env services get app >/dev/null 2>&1; then
  sprite-env services delete app >/dev/null
fi

SERVICE_CMD="cd /home/sprite/app && bm web --service app --host 0.0.0.0 --port 8080"
if [[ -n "${BM_CLICKHOUSE_URL:-}" ]]; then
  echo "[bootstrap] Injecting BM_CLICKHOUSE_URL into app service command env"
  SERVICE_CMD="cd /home/sprite/app && BM_CLICKHOUSE_URL=${BM_CLICKHOUSE_URL} bm web --service app --host 0.0.0.0 --port 8080"
fi

sprite-env services create app --cmd bash --args "-lc,${SERVICE_CMD}" --http-port 8080

echo "[bootstrap] Starting app service"
sprite-env services start app

echo "[bootstrap] Done"
BOOTSTRAP
chmod +x "${WORK_DIR}/bootstrap.sh"

echo "[3/4] Creating archive"
tar -C "${WORK_DIR}" -czf "${BUNDLE_OUTPUT}" .

echo "[4/4] Bundle ready"
echo "==> Bundle created: ${BUNDLE_OUTPUT}"
echo "    Size: $(du -h "${BUNDLE_OUTPUT}" | cut -f1)"
echo "    Contents:"
tar -tzf "${BUNDLE_OUTPUT}" | head -20 || true
