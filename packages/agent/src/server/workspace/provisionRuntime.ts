import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROVISIONING_VERSION = 1

export interface RuntimeTemplateContribution {
  id: string
  path: string | URL
  target?: string
}

export interface RuntimePythonSpec {
  id: string
  /** uv-compatible pyproject.toml. Console scripts declared here are exposed to the agent. */
  projectFile: string | URL
  /** Extra workspace libraries to install into the same environment. */
  extraLibs?: string[]
  /** Env vars exported by command shims, e.g. plugin builtin paths. */
  env?: Record<string, string | URL>
}

export interface RuntimeProvisioningContribution {
  templateDirs?: RuntimeTemplateContribution[]
  python?: RuntimePythonSpec[]
}

export interface ProvisionRuntimeWorkspaceOptions {
  workspaceRoot: string
  contributions?: Array<{ id: string; provisioning?: RuntimeProvisioningContribution }>
  force?: boolean
}

export interface RuntimeWorkspaceProvisioningResult {
  fingerprint: string
  changed: boolean
  env: Record<string, string>
  binDir: string
}

function toPath(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : value
}

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
    timeout: 5 * 60 * 1000,
  })
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(cmd, ['--version'], { maxBuffer: 1024 * 1024 })
    return true
  } catch {
    return false
  }
}

async function hashPath(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const info = await stat(path)
  if (info.isDirectory()) {
    const entries = (await readdir(path))
      .filter((entry) => entry !== '__pycache__' && entry !== 'build' && !entry.endsWith('.egg-info'))
      .sort()
    for (const entry of entries) {
      hash.update(`dir:${entry}\n`)
      await hashPath(join(path, entry), hash)
    }
    return
  }
  if (!info.isFile()) return
  hash.update(`file:${path}\n`)
  hash.update(await readFile(path))
}

async function fingerprint(contributions: Array<{ id: string; provisioning: RuntimeProvisioningContribution }>): Promise<string> {
  const hash = createHash('sha256')
  hash.update(JSON.stringify({ v: PROVISIONING_VERSION }))
  for (const { id, provisioning } of contributions) {
    hash.update(`plugin:${id}\n`)
    for (const template of provisioning.templateDirs ?? []) {
      const templatePath = toPath(template.path)
      hash.update(`template:${template.id}:${template.target ?? ''}:${templatePath}\n`)
      if (await exists(templatePath)) await hashPath(templatePath, hash)
    }
    for (const spec of provisioning.python ?? []) {
      const projectFile = toPath(spec.projectFile)
      hash.update(`python:${spec.id}:${projectFile}\n`)
      hash.update(JSON.stringify(spec.extraLibs ?? []))
      hash.update(JSON.stringify(Object.fromEntries(Object.entries(spec.env ?? {}).map(([k, v]) => [k, String(v)]))))
      if (await exists(projectFile)) await hashPath(dirname(projectFile), hash)
    }
  }
  return `sha256:${hash.digest('hex')}`
}

function collectEnv(contributions: Array<{ provisioning: RuntimeProvisioningContribution }>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const { provisioning } of contributions) {
    for (const spec of provisioning.python ?? []) {
      for (const [key, value] of Object.entries(spec.env ?? {}) as Array<[string, string | URL]>) {
        env[key] = toPath(value)
      }
    }
  }
  return env
}

async function seedTemplates(workspaceRoot: string, contributions: Array<{ provisioning: RuntimeProvisioningContribution }>): Promise<void> {
  for (const { provisioning } of contributions) {
    for (const template of provisioning.templateDirs ?? []) {
      await cp(toPath(template.path), resolve(workspaceRoot, template.target ?? '.'), {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
    }
  }
}

async function ensurePython(workspaceRoot: string, specs: RuntimePythonSpec[]): Promise<void> {
  if (specs.length === 0) return
  const venvPython = join(workspaceRoot, '.venv', 'bin', 'python')
  const uv = await commandExists('uv')
  if (!(await exists(venvPython))) {
    if (uv) await run('uv', ['venv', '.venv'], workspaceRoot)
    else await run('/usr/bin/python3', ['-m', 'venv', '.venv'], workspaceRoot)
  }

  for (const spec of specs) {
    const projectDir = dirname(toPath(spec.projectFile))
    if (uv) {
      await run('uv', ['pip', 'install', '--python', venvPython, projectDir], workspaceRoot)
      if (spec.extraLibs?.length) {
        await run('uv', ['pip', 'install', '--python', venvPython, ...spec.extraLibs], workspaceRoot)
      }
    } else {
      await run(venvPython, ['-m', 'pip', 'install', projectDir], workspaceRoot)
      if (spec.extraLibs?.length) await run(venvPython, ['-m', 'pip', 'install', ...spec.extraLibs], workspaceRoot)
    }
  }
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
}

function bashSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function assertEnvKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid provisioning env key: ${key}`)
  }
}

async function isRuntimeMaterialized(
  workspaceRoot: string,
  contributions: Array<{ provisioning: RuntimeProvisioningContribution }>,
): Promise<boolean> {
  const hasPython = contributions.some(({ provisioning }) => (provisioning.python ?? []).length > 0)
  if (hasPython && !(await exists(join(workspaceRoot, '.venv', 'bin', 'python')))) return false
  return true
}

async function writeShims(workspaceRoot: string, env: Record<string, string>): Promise<string> {
  const shimDir = join(workspaceRoot, '.boring-agent', 'bin')
  const venvBin = join(workspaceRoot, '.venv', 'bin')
  await mkdir(shimDir, { recursive: true })
  const exports = Object.entries(env).map(([key, value]) => {
    assertEnvKey(key)
    return `export ${key}=${bashSingleQuote(value)}`
  }).join('\n')
  const base = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
export BORING_AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"
${exports}
VENV_BIN="$WORKSPACE_ROOT/.venv/bin"
`

  await writeExecutable(join(shimDir, 'python'), `${base}exec "$VENV_BIN/python" "$@"\n`)
  await writeExecutable(join(shimDir, 'python3'), `${base}exec "$VENV_BIN/python" "$@"\n`)
  await writeExecutable(join(shimDir, 'pip'), `${base}exec "$VENV_BIN/python" -m pip "$@"\n`)
  await writeExecutable(join(shimDir, 'pip3'), `${base}exec "$VENV_BIN/python" -m pip "$@"\n`)

  if (await exists(venvBin)) {
    for (const entry of await readdir(venvBin)) {
      if (['python', 'python3', 'pip', 'pip3'].includes(entry)) continue
      const full = join(venvBin, entry)
      const info = await stat(full).catch(() => null)
      if (!info?.isFile()) continue
      await writeExecutable(join(shimDir, entry), `${base}TARGET="$VENV_BIN"/${bashSingleQuote(entry)}
SHEBANG="$(head -n 1 "$TARGET" 2>/dev/null || true)"
case "$SHEBANG" in
  *python*) exec "$VENV_BIN/python" "$TARGET" "$@" ;;
esac
exec "$TARGET" "$@"
`)
    }
  }
  return shimDir
}

export async function provisionRuntimeWorkspace({
  workspaceRoot,
  contributions,
  force = false,
}: ProvisionRuntimeWorkspaceOptions): Promise<RuntimeWorkspaceProvisioningResult> {
  const active: Array<{ id: string; provisioning: RuntimeProvisioningContribution }> = []
  for (const contribution of contributions ?? []) {
    if (contribution.provisioning) active.push({ id: contribution.id, provisioning: contribution.provisioning })
  }

  await mkdir(workspaceRoot, { recursive: true })
  const env = collectEnv(active)
  const hash = await fingerprint(active)
  const markerPath = join(workspaceRoot, '.boring-agent', 'provisioning.json')
  const binDir = join(workspaceRoot, '.boring-agent', 'bin')

  if (!force && await exists(markerPath)) {
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { fingerprint?: string }
      if (marker.fingerprint === hash && await isRuntimeMaterialized(workspaceRoot, active)) {
        await writeShims(workspaceRoot, env)
        return { fingerprint: hash, changed: false, env, binDir }
      }
    } catch {
      // corrupted marker: reprovision
    }
  }

  await seedTemplates(workspaceRoot, active)
  await ensurePython(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.python ?? []))
  const actualBinDir = await writeShims(workspaceRoot, env)
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, JSON.stringify({ v: PROVISIONING_VERSION, fingerprint: hash }, null, 2), 'utf8')
  return { fingerprint: hash, changed: true, env, binDir: actualBinDir }
}
