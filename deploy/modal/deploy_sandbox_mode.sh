#!/usr/bin/env bash
set -euo pipefail

# Deploy boring-sandbox gateway via Modal.
#
# Usage:
#   ./deploy/modal/deploy_sandbox_mode.sh [gateway|gateway_ui_light]
#
# Env vars:
#   BORING_SANDBOX_REPO — path to boring-sandbox checkout (default: sibling dir)
#   MODAL_DEPLOY_NAME   — custom --name for modal deploy (optional)
#   MODAL_ENV           — Modal environment (optional)

BORING_SANDBOX_REPO="${BORING_SANDBOX_REPO:-$(cd "$(dirname "$0")/../../.." && pwd)/boring-sandbox}"
ENTRYPOINT="${1:-gateway}"

if [[ ! -f "${BORING_SANDBOX_REPO}/src/boring_sandbox/modal_app.py" ]]; then
  echo "Missing boring-sandbox modal app: ${BORING_SANDBOX_REPO}/src/boring_sandbox/modal_app.py" >&2
  echo "Set BORING_SANDBOX_REPO to your boring-sandbox checkout path." >&2
  exit 1
fi

case "${ENTRYPOINT}" in
  gateway|gateway_ui_light)
    ;;
  *)
    echo "Unsupported entrypoint '${ENTRYPOINT}'. Use 'gateway' or 'gateway_ui_light'." >&2
    exit 1
    ;;
esac

cmd=(modal deploy)
if [[ -n "${MODAL_DEPLOY_NAME:-}" ]]; then
  cmd+=(--name "${MODAL_DEPLOY_NAME}")
fi
if [[ -n "${MODAL_ENV:-}" ]]; then
  cmd+=(--env "${MODAL_ENV}")
fi
cmd+=("${BORING_SANDBOX_REPO}/src/boring_sandbox/modal_app.py::${ENTRYPOINT}")

exec "${cmd[@]}"
