import { cp, mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const workspaceTemplatePath = fileURLToPath(
  new URL("../plugins/macro/server/workspace-template", import.meta.url),
)
const sdkProjectPath = fileURLToPath(
  new URL("../plugins/macro/server/sdk", import.meta.url),
)

const SHIM_HEADER = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
export BORING_AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"
VENV_BIN="$WORKSPACE_ROOT/.venv/bin"
SDK_ROOT="$WORKSPACE_ROOT/.boring-agent/sdk/boring-macro-sdk"
ensure_venv() {
  if [[ ! -x "$VENV_BIN/python" ]]; then
    /usr/bin/python3 -m venv "$WORKSPACE_ROOT/.venv"
  fi
  if ! "$VENV_BIN/python" -c 'import boring_macro' >/dev/null 2>&1; then
    "$VENV_BIN/python" -m pip install --progress-bar off "$SDK_ROOT" >&2
  fi
}
`

const BM_SHIM = `${SHIM_HEADER}
ensure_venv
exec "$VENV_BIN/bm" "$@"
`

const PYTHON_SHIM = `${SHIM_HEADER}
ensure_venv
exec "$VENV_BIN/python" "$@"
`

const PIP_SHIM = `${SHIM_HEADER}
ensure_venv
exec "$VENV_BIN/python" -m pip "$@"
`

function shouldCopySdkPath(source: string): boolean {
  return !source.split(/[\\/]/).includes("__pycache__") && !source.endsWith(".pyc")
}

export async function prepareMacroSandboxTemplate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-macro-sandbox-template-"))
  await cp(workspaceTemplatePath, root, { recursive: true, force: true })

  const sdkTarget = join(root, ".boring-agent", "sdk", "boring-macro-sdk")
  await mkdir(sdkTarget, { recursive: true })
  await cp(join(sdkProjectPath, "pyproject.toml"), join(sdkTarget, "pyproject.toml"), { force: true })
  await cp(join(sdkProjectPath, "boring_macro"), join(sdkTarget, "boring_macro"), {
    recursive: true,
    force: true,
    filter: shouldCopySdkPath,
  })

  const binDir = join(root, ".boring-agent", "bin")
  await mkdir(binDir, { recursive: true })
  await Promise.all([
    writeFile(join(binDir, "bm"), BM_SHIM, { mode: 0o755 }),
    writeFile(join(binDir, "python"), PYTHON_SHIM, { mode: 0o755 }),
    writeFile(join(binDir, "python3"), PYTHON_SHIM, { mode: 0o755 }),
    writeFile(join(binDir, "pip"), PIP_SHIM, { mode: 0o755 }),
    writeFile(join(binDir, "pip3"), PIP_SHIM, { mode: 0o755 }),
  ])

  return root
}
