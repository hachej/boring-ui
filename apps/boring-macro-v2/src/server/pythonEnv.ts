import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyBaseLogger } from 'fastify'

const execFileAsync = promisify(execFile)

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function run(cmd: string, args: string[], cwd: string): Promise<void> {
  await execFileAsync(cmd, args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024 * 20,
  })
}

async function installWorkspaceCommandShims(root: string): Promise<void> {
  const shimDir = join(root, '.boring-agent', 'bin')
  await mkdir(shimDir, { recursive: true })

  const writeShim = async (name: string, body: string): Promise<void> => {
    const shimPath = join(shimDir, name)
    await writeFile(shimPath, body, 'utf8')
    await chmod(shimPath, 0o755)
  }

  const base = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- \"$SCRIPT_DIR/../..\" && pwd)"
export BORING_AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"
VENV_BIN="$WORKSPACE_ROOT/.venv/bin"
`

  await writeShim('python', `${base}exec "$VENV_BIN/python" "$@"
`)
  await writeShim('python3', `${base}exec "$VENV_BIN/python" "$@"
`)
  await writeShim('pip', `${base}exec "$VENV_BIN/python" -m pip "$@"
`)
  await writeShim('pip3', `${base}exec "$VENV_BIN/python" -m pip "$@"
`)
  await writeShim('bm', `${base}exec "$VENV_BIN/python" -m boring_macro._cli "$@"
`)
}

export interface PythonEnvOptions {
  /** Absolute path to the boring-macro-sdk package directory. */
  sdkPath: string
  logger?: FastifyBaseLogger
}

/**
 * Ensure a Python venv exists at `<root>/.venv` with boring-macro-sdk installed.
 * The BORING_AGENT_WORKSPACE_ROOT env var is set to `workspaceRoot` so the SDK
 * can resolve transform paths correctly at runtime.
 *
 * @param root   Directory that will contain the `.venv` subfolder.
 *               In normal use this is workspaceRoot; in eval it's a stable
 *               cache dir so the venv isn't rebuilt for every test run.
 * @param opts   sdkPath: absolute path to the boring-macro-sdk package.
 */
export async function ensureWorkspacePythonEnv(
  root: string,
  opts: PythonEnvOptions,
): Promise<void> {
  const { sdkPath, logger } = opts
  await mkdir(root, { recursive: true })

  const venvPython = join(root, '.venv', 'bin', 'python')
  const venvPip = join(root, '.venv', 'bin', 'pip')

  if (!(await exists(venvPython))) {
    logger?.info({ root }, 'creating python venv')
    await run('/usr/bin/python3', ['-m', 'venv', '.venv'], root)
  }

  try {
    await run(venvPython, ['-c', 'import boring_macro'], root)
    await installWorkspaceCommandShims(root)
    logger?.info({ root }, 'workspace python env ready')
    return
  } catch {
    logger?.info({ root }, 'installing boring-macro-sdk into python venv')
    await run(venvPip, ['install', sdkPath], root)
  }

  await run(venvPython, ['-c', 'import boring_macro'], root)
  await installWorkspaceCommandShims(root)
  logger?.info({ root }, 'workspace python env ready')
}
