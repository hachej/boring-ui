import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ensureBoringAgentRuntimeLayout,
  getBoringAgentNodePackageTarget,
  getBoringAgentRuntimePaths,
  removeLegacyTopLevelVenvIfOwned,
  writeBoringAgentOwnershipMarker,
} from './runtimeLayout'

const execFileAsync = promisify(execFile)
const PROVISIONING_VERSION = 2

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

export interface RuntimeNodePackageSpec {
  id: string
  /** Package name materialized under workspaceRoot/node_modules, e.g. @boring/workspace. */
  packageName: string
  /** Source package root. The provisioner copies the built package payload into node_modules. */
  packageRoot: string | URL
}

export interface RuntimeProvisioningContribution {
  templateDirs?: RuntimeTemplateContribution[]
  python?: RuntimePythonSpec[]
  nodePackages?: RuntimeNodePackageSpec[]
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
    for (const spec of provisioning.nodePackages ?? []) {
      const packageRoot = toPath(spec.packageRoot)
      hash.update(`node-package:${spec.id}:${spec.packageName}:${packageRoot}\n`)
      const packageJson = join(packageRoot, 'package.json')
      const distDir = join(packageRoot, 'dist')
      const docsDir = join(packageRoot, 'docs')
      const skillsDir = join(packageRoot, 'skills')
      const referencesDir = join(packageRoot, 'references')
      const sourceDocsDir = join(packageRoot, 'src', 'server', 'docs')
      if (await exists(packageJson)) await hashPath(packageJson, hash)
      if (await exists(distDir)) await hashPath(distDir, hash)
      const templatesDir = join(packageRoot, 'templates')
      const publicDir = join(packageRoot, 'public')
      if (await exists(templatesDir)) await hashPath(templatesDir, hash)
      if (await exists(publicDir)) await hashPath(publicDir, hash)
      if (await exists(docsDir)) await hashPath(docsDir, hash)
      if (await exists(skillsDir)) await hashPath(skillsDir, hash)
      if (await exists(referencesDir)) await hashPath(referencesDir, hash)
      else if (!(await exists(distDir)) && await exists(sourceDocsDir)) await hashPath(sourceDocsDir, hash)
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

function resolveTemplateTarget(workspaceRoot: string, target: string | undefined): string {
  const rawTarget = target ?? '.'
  if (
    rawTarget.length === 0 ||
    rawTarget.includes('\0') ||
    rawTarget.includes('\\') ||
    rawTarget.startsWith('/') ||
    rawTarget.startsWith('//') ||
    /^[A-Za-z]:[\\/]/.test(rawTarget) ||
    rawTarget.split('/').includes('..')
  ) {
    throw new Error(`Unsafe runtime template target: ${JSON.stringify(rawTarget)}. Template targets must be relative paths inside the workspace.`)
  }
  const root = resolve(workspaceRoot)
  const resolved = resolve(root, rawTarget)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Unsafe runtime template target: ${JSON.stringify(rawTarget)} resolves outside the workspace.`)
  }
  return resolved
}

async function seedTemplates(workspaceRoot: string, contributions: Array<{ provisioning: RuntimeProvisioningContribution }>): Promise<void> {
  for (const { provisioning } of contributions) {
    for (const template of provisioning.templateDirs ?? []) {
      await cp(toPath(template.path), resolveTemplateTarget(workspaceRoot, template.target), {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
    }
  }
}

function nodePackageTarget(workspaceRoot: string, packageName: string): string {
  return getBoringAgentNodePackageTarget(workspaceRoot, packageName)
}

async function copyIfExists(source: string, target: string): Promise<boolean> {
  if (!(await exists(source))) return false
  await cp(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })
  return true
}

async function ensureNodePackages(workspaceRoot: string, specs: RuntimeNodePackageSpec[]): Promise<void> {
  for (const spec of specs) {
    const packageRoot = toPath(spec.packageRoot)
    const target = nodePackageTarget(workspaceRoot, spec.packageName)
    await mkdir(target, { recursive: true })

    const copiedPackageJson = await copyIfExists(join(packageRoot, 'package.json'), join(target, 'package.json'))
    if (!copiedPackageJson) {
      throw new Error(`Node package provisioning source is missing package.json: ${packageRoot}`)
    }

    await copyIfExists(join(packageRoot, 'dist'), join(target, 'dist'))
    await copyIfExists(join(packageRoot, 'templates'), join(target, 'templates'))
    await copyIfExists(join(packageRoot, 'public'), join(target, 'public'))
    // Source-tree/dev fallback: make the canonical docs readable from the
    // same package path the system prompt points to, even before a package
    // build has created dist/docs. Also patches old dist directories that
    // predate the docs asset copy step.
    if (!(await exists(join(target, 'dist', 'docs', 'plugins.md')))) {
      await copyIfExists(join(packageRoot, 'src', 'server', 'docs'), join(target, 'dist', 'docs'))
    }
    // Pi package skills use package-relative docs/ paths, matching npm
    // installs. Materialize root docs in provisioned child workspaces too.
    if (!(await copyIfExists(join(packageRoot, 'docs'), join(target, 'docs')))) {
      await copyIfExists(join(packageRoot, 'src', 'server', 'docs'), join(target, 'docs'))
    }
    await copyIfExists(join(packageRoot, 'skills'), join(target, 'skills'))
    await copyIfExists(join(packageRoot, 'references'), join(target, 'references'))
    await copyIfExists(join(packageRoot, 'src', 'globals.css'), join(target, 'src', 'globals.css'))
  }
}

async function ensurePython(workspaceRoot: string, specs: RuntimePythonSpec[]): Promise<void> {
  if (specs.length === 0) return
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const venvPython = paths.venvPython
  const uv = await commandExists('uv')
  if (!(await exists(venvPython))) {
    if (uv) await run('uv', ['venv', '--allow-existing', paths.venv], workspaceRoot)
    else await run('/usr/bin/python3', ['-m', 'venv', paths.venv], workspaceRoot)
    await writeBoringAgentOwnershipMarker(paths.venv, '.boring-agent/venv')
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
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const hasPython = contributions.some(({ provisioning }) => (provisioning.python ?? []).length > 0)
  if (hasPython && !(await exists(paths.venvPython))) return false
  for (const { provisioning } of contributions) {
    for (const spec of provisioning.nodePackages ?? []) {
      if (!(await exists(join(nodePackageTarget(workspaceRoot, spec.packageName), 'package.json')))) return false
    }
  }
  return true
}

async function writeShims(workspaceRoot: string, env: Record<string, string>): Promise<string> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const shimDir = paths.bin
  const venvBin = paths.venvBin
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
VENV_BIN="$WORKSPACE_ROOT/.boring-agent/venv/bin"
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

async function readProvisioningMarker(
  markerPath: string,
  legacyMarkerPath: string,
): Promise<{ marker: { fingerprint?: string }, source: 'current' | 'legacy' } | null> {
  const candidates = [
    { path: markerPath, source: 'current' as const },
    { path: legacyMarkerPath, source: 'legacy' as const },
  ]

  for (const candidate of candidates) {
    if (!(await exists(candidate.path))) continue
    try {
      return {
        marker: JSON.parse(await readFile(candidate.path, 'utf8')) as { fingerprint?: string },
        source: candidate.source,
      }
    } catch {
      if (candidate.source === 'current') return null
      // corrupted legacy marker: ignore and reprovision
    }
  }

  return null
}

async function writeProvisioningMarker(markerPath: string, hash: string): Promise<void> {
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, JSON.stringify({ v: PROVISIONING_VERSION, fingerprint: hash }, null, 2), 'utf8')
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
  const paths = await ensureBoringAgentRuntimeLayout(workspaceRoot)
  await removeLegacyTopLevelVenvIfOwned(workspaceRoot)
  const env = collectEnv(active)
  const hash = await fingerprint(active)
  const markerPath = paths.provisioningMarker
  const legacyMarkerPath = paths.legacyProvisioningMarker
  const binDir = paths.bin

  if (!force) {
    const markerResult = await readProvisioningMarker(markerPath, legacyMarkerPath)
    if (markerResult?.marker.fingerprint === hash && await isRuntimeMaterialized(workspaceRoot, active)) {
      await writeShims(workspaceRoot, env)
      if (markerResult.source === 'legacy') await writeProvisioningMarker(markerPath, hash)
      return { fingerprint: hash, changed: false, env, binDir }
    }
  }

  await seedTemplates(workspaceRoot, active)
  await ensureNodePackages(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.nodePackages ?? []))
  await ensurePython(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.python ?? []))
  const actualBinDir = await writeShims(workspaceRoot, env)
  await writeProvisioningMarker(markerPath, hash)
  return { fingerprint: hash, changed: true, env, binDir: actualBinDir }
}
