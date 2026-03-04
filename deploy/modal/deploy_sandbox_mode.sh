#!/usr/bin/env bash
set -euo pipefail

# Reuse the existing boring-sandbox Modal deployment entrypoint.
# Default repo location assumes sibling checkouts.
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

exec modal deploy "${BORING_SANDBOX_REPO}/src/boring_sandbox/modal_app.py::${ENTRYPOINT}"
