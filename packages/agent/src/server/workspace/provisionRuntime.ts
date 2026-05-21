import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RuntimeModeId } from '../runtime/mode'
import type { Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'
import {
  BORING_AGENT_DIR,
  BORING_AGENT_LEGACY_PROVISIONING_MARKER_REL_PATH,
  BORING_AGENT_OWNER,
  BORING_AGENT_OWNERSHIP_MANIFEST_REL_PATH,
  BORING_AGENT_OWNERSHIP_MARKER_FILENAME,
  BORING_AGENT_OWNERSHIP_MARKER_VERSION,
  BORING_AGENT_PROVISIONING_MARKER_REL_PATH,
  BORING_AGENT_RUNTIME_DIR_NAMES,
  ensureBoringAgentRuntimeLayout,
  getBoringAgentNodePackageTarget,
  getBoringAgentRuntimePaths,
  removeLegacyTopLevelVenvIfOwned,
  writeBoringAgentOwnershipMarker,
} from './runtimeLayout'

const execFileAsync = promisify(execFile)
const PROVISIONING_VERSION = 3
const DEFAULT_REMOTE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_REMOTE_MAX_OUTPUT_BYTES = 1024 * 1024 * 20

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
  /** Host/storage root for direct/local provisioning and source fingerprint state. */
  workspaceRoot: string
  contributions?: Array<{ id: string; provisioning?: RuntimeProvisioningContribution }>
  force?: boolean
  /** Runtime-visible cwd that tools will execute in. Defaults to workspaceRoot for direct mode. */
  runtimeCwd?: string
  /** Runtime mode id used in provisioning state/fingerprint. */
  runtimeMode?: RuntimeModeId
  /** Host/storage root when workspaceRoot is not the right private fs target. */
  storageRoot?: string
  /** Runtime Workspace. Required for remote sandbox provisioning. */
  workspace?: Workspace
  /** Runtime Sandbox. Used for remote provisioning and local/bwrap validation. */
  sandbox?: Sandbox
}

export interface RuntimeWorkspaceProvisioningResult {
  fingerprint: string
  changed: boolean
  env: Record<string, string>
  binDir: string
}

interface ProvisionTarget {
  runtimeMode: RuntimeModeId
  runtimeCwd: string
  sandboxProvider?: string
}

function toPath(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : value
}

function envValueToString(value: string | URL, target?: ProvisionTarget, spec?: RuntimePythonSpec, key?: string): string {
  if (!(value instanceof URL)) return value
  if (value.protocol === 'file:') {
    const filePath = fileURLToPath(value)
    if (target?.runtimeMode === 'vercel-sandbox' && spec) {
      const projectDir = dirname(toPath(spec.projectFile))
      const rel = relative(projectDir, filePath)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Remote provisioning env key ${key ?? '<unknown>'} points outside provisioned project: ${value.toString()}`)
      }
      const remoteRel = rel ? rel.replaceAll('\\', '/') : ''
      return `${target.runtimeCwd}/${remotePythonProjectTarget(spec)}${remoteRel ? `/${remoteRel}` : ''}`
    }
    return filePath
  }
  if (value.protocol === 'http:' || value.protocol === 'https:') return value.toString()
  return value.toString()
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isNotFound(error: unknown): boolean {
  const maybe = error as { code?: unknown; status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null
  return maybe?.code === 'ENOENT' || maybe?.status === 404 || maybe?.statusCode === 404 || maybe?.response?.status === 404
}

async function workspaceExists(workspace: Workspace, relPath: string): Promise<boolean> {
  try {
    await workspace.stat(relPath)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    return false
  }
}

async function workspaceReadJsonMarker(
  workspace: Workspace,
  markerPath: string,
  legacyMarkerPath: string,
): Promise<{ marker: { fingerprint?: string }, source: 'current' | 'legacy' } | null> {
  const candidates = [
    { path: markerPath, source: 'current' as const },
    { path: legacyMarkerPath, source: 'legacy' as const },
  ]
  for (const candidate of candidates) {
    if (!(await workspaceExists(workspace, candidate.path))) continue
    try {
      return {
        marker: JSON.parse(await workspace.readFile(candidate.path)) as { fingerprint?: string },
        source: candidate.source,
      }
    } catch {
      if (candidate.source === 'current') return null
    }
  }
  return null
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function sandboxRun(sandbox: Sandbox, cmd: string, cwd: string): Promise<void> {
  const result = await sandbox.exec(cmd, {
    cwd,
    timeoutMs: DEFAULT_REMOTE_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_REMOTE_MAX_OUTPUT_BYTES,
  })
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr)
    const stdout = new TextDecoder().decode(result.stdout)
    throw new Error(`Provisioning command failed in ${sandbox.provider} (exit ${result.exitCode}): ${stderr || stdout || cmd}`)
  }
}

async function sandboxCommandExists(sandbox: Sandbox, cmd: string, cwd: string): Promise<boolean> {
  const result = await sandbox.exec(`command -v ${shellQuote(cmd)} >/dev/null 2>&1`, {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 1024 * 1024,
  })
  return result.exitCode === 0
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

async function fingerprint(
  contributions: Array<{ id: string; provisioning: RuntimeProvisioningContribution }>,
  target: ProvisionTarget,
): Promise<string> {
  const hash = createHash('sha256')
  hash.update(JSON.stringify({
    v: PROVISIONING_VERSION,
    runtimeMode: target.runtimeMode,
    runtimeCwd: target.runtimeCwd,
  }))
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

const RESERVED_PLUGIN_ENV_KEYS = new Set([
  'BORING_AGENT_WORKSPACE_ROOT',
  'VIRTUAL_ENV',
  'HOME',
  'PYTHONHOME',
])

function collectEnv(
  contributions: Array<{ provisioning: RuntimeProvisioningContribution }>,
  target?: ProvisionTarget,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const { provisioning } of contributions) {
    for (const spec of provisioning.python ?? []) {
      for (const [key, value] of Object.entries(spec.env ?? {}) as Array<[string, string | URL]>) {
        if (RESERVED_PLUGIN_ENV_KEYS.has(key)) {
          throw new Error(`Provisioning env key ${key} is reserved by boring-agent runtime`)
        }
        env[key] = envValueToString(value, target, spec, key)
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

function nodePackageTargetRel(packageName: string): string {
  const parts = packageName.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid node package name: ${packageName}`)
  }
  return posix.join(BORING_AGENT_DIR, 'node', 'node_modules', ...parts)
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

function buildShimBase(env: Record<string, string>): string {
  const pluginPath = env.PATH
  const exports = Object.entries(env).filter(([key]) => key !== 'PATH').map(([key, value]) => {
    assertEnvKey(key)
    return `export ${key}=${bashSingleQuote(value)}`
  }).join('\n')
  const pluginPathExport = pluginPath
    ? `PLUGIN_PATH=${bashSingleQuote(pluginPath)}\nexport PATH="$WORKSPACE_ROOT/.boring-agent/bin:$VENV_BIN:$PLUGIN_PATH\${PATH:+:$PATH}"`
    : `export PATH="$WORKSPACE_ROOT/.boring-agent/bin:$VENV_BIN\${PATH:+:$PATH}"`
  return `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
export BORING_AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"
export VIRTUAL_ENV="$WORKSPACE_ROOT/.boring-agent/venv"
VENV_BIN="$WORKSPACE_ROOT/.boring-agent/venv/bin"
${pluginPathExport}
${exports}
`
}

async function writeShims(workspaceRoot: string, env: Record<string, string>): Promise<string> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const shimDir = paths.bin
  const venvBin = paths.venvBin
  await mkdir(shimDir, { recursive: true })
  const base = buildShimBase(env)

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

function provisioningMarkerBody(hash: string, target: ProvisionTarget): string {
  return `${JSON.stringify({
    v: PROVISIONING_VERSION,
    fingerprint: hash,
    runtimeMode: target.runtimeMode,
    runtimeCwd: target.runtimeCwd,
    ...(target.sandboxProvider ? { sandboxProvider: target.sandboxProvider } : {}),
  }, null, 2)}\n`
}

async function writeProvisioningMarker(markerPath: string, hash: string, target: ProvisionTarget): Promise<void> {
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, provisioningMarkerBody(hash, target), 'utf8')
}

function resolveTarget(opts: ProvisionRuntimeWorkspaceOptions): ProvisionTarget {
  const runtimeCwd = opts.runtimeCwd ?? opts.workspace?.runtimeContext.runtimeCwd ?? opts.sandbox?.runtimeContext.runtimeCwd ?? opts.workspaceRoot
  const provider = opts.sandbox?.provider
  const runtimeMode = opts.runtimeMode ?? (provider === 'vercel-sandbox'
    ? 'vercel-sandbox'
    : provider === 'bwrap'
      ? 'local'
      : 'direct')
  return {
    runtimeMode,
    runtimeCwd,
    ...(provider ? { sandboxProvider: provider } : {}),
  }
}

async function provisionHostRuntimeWorkspace(
  opts: ProvisionRuntimeWorkspaceOptions,
  target: ProvisionTarget,
  active: Array<{ id: string; provisioning: RuntimeProvisioningContribution }>,
  env: Record<string, string>,
  hash: string,
): Promise<RuntimeWorkspaceProvisioningResult> {
  const workspaceRoot = opts.storageRoot ?? opts.workspaceRoot
  await mkdir(workspaceRoot, { recursive: true })
  const paths = await ensureBoringAgentRuntimeLayout(workspaceRoot)
  await removeLegacyTopLevelVenvIfOwned(workspaceRoot)
  const markerPath = paths.provisioningMarker
  const legacyMarkerPath = paths.legacyProvisioningMarker
  const binDir = paths.bin

  if (!opts.force) {
    const markerResult = await readProvisioningMarker(markerPath, legacyMarkerPath)
    if (markerResult?.marker.fingerprint === hash && await isRuntimeMaterialized(workspaceRoot, active)) {
      await writeShims(workspaceRoot, env)
      if (markerResult.source === 'legacy') await writeProvisioningMarker(markerPath, hash, target)
      if (opts.sandbox && target.runtimeMode === 'local') await validateRuntimeInSandbox(opts.sandbox, target.runtimeCwd, active)
      return { fingerprint: hash, changed: false, env, binDir }
    }
  }

  await seedTemplates(workspaceRoot, active)
  await ensureNodePackages(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.nodePackages ?? []))
  await ensurePython(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.python ?? []))
  const actualBinDir = await writeShims(workspaceRoot, env)
  await writeProvisioningMarker(markerPath, hash, target)
  if (opts.sandbox && target.runtimeMode === 'local') await validateRuntimeInSandbox(opts.sandbox, target.runtimeCwd, active)
  return { fingerprint: hash, changed: true, env, binDir: actualBinDir }
}

async function ensureRemoteRuntimeLayout(workspace: Workspace): Promise<void> {
  await workspace.mkdir(BORING_AGENT_DIR, { recursive: true })
  const ownedRelPaths = BORING_AGENT_RUNTIME_DIR_NAMES.map((dirName) => posix.join(BORING_AGENT_DIR, dirName))
  for (const relPath of ownedRelPaths) {
    await workspace.mkdir(relPath, { recursive: true })
    await workspace.writeFile(
      posix.join(relPath, BORING_AGENT_OWNERSHIP_MARKER_FILENAME),
      `${JSON.stringify({
        v: BORING_AGENT_OWNERSHIP_MARKER_VERSION,
        owner: BORING_AGENT_OWNER,
        path: relPath,
        kind: 'runtime-dir',
      }, null, 2)}\n`,
    )
  }
  await workspace.writeFile(
    BORING_AGENT_OWNERSHIP_MANIFEST_REL_PATH,
    `${JSON.stringify({
      v: BORING_AGENT_OWNERSHIP_MARKER_VERSION,
      owner: BORING_AGENT_OWNER,
      paths: ownedRelPaths,
    }, null, 2)}\n`,
  )
}

async function copyHostPathToWorkspace(
  source: string,
  workspace: Workspace,
  targetRel: string,
): Promise<boolean> {
  const info = await stat(source).catch((error: unknown) => {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  })
  if (!info) return false
  if (info.isDirectory()) {
    await workspace.mkdir(targetRel, { recursive: true })
    const entries = (await readdir(source)).sort()
    for (const entry of entries) {
      await copyHostPathToWorkspace(join(source, entry), workspace, posix.join(targetRel, entry))
    }
    return true
  }
  if (!info.isFile()) return false
  const data = await readFile(source)
  if (workspace.writeBinaryFile) await workspace.writeBinaryFile(targetRel, new Uint8Array(data))
  else await workspace.writeFile(targetRel, data.toString('utf8'))
  return true
}

async function seedRemoteTemplates(workspace: Workspace, contributions: Array<{ provisioning: RuntimeProvisioningContribution }>): Promise<void> {
  for (const { provisioning } of contributions) {
    for (const template of provisioning.templateDirs ?? []) {
      await copyHostPathToWorkspace(toPath(template.path), workspace, template.target ?? '.')
    }
  }
}

async function ensureRemoteNodePackages(workspace: Workspace, specs: RuntimeNodePackageSpec[]): Promise<void> {
  for (const spec of specs) {
    const packageRoot = toPath(spec.packageRoot)
    const target = nodePackageTargetRel(spec.packageName)
    await workspace.mkdir(target, { recursive: true })

    const copiedPackageJson = await copyHostPathToWorkspace(join(packageRoot, 'package.json'), workspace, posix.join(target, 'package.json'))
    if (!copiedPackageJson) {
      throw new Error(`Node package provisioning source is missing package.json: ${packageRoot}`)
    }

    await copyHostPathToWorkspace(join(packageRoot, 'dist'), workspace, posix.join(target, 'dist'))
    await copyHostPathToWorkspace(join(packageRoot, 'templates'), workspace, posix.join(target, 'templates'))
    await copyHostPathToWorkspace(join(packageRoot, 'public'), workspace, posix.join(target, 'public'))
    if (!(await workspaceExists(workspace, posix.join(target, 'dist', 'docs', 'plugins.md')))) {
      await copyHostPathToWorkspace(join(packageRoot, 'src', 'server', 'docs'), workspace, posix.join(target, 'dist', 'docs'))
    }
    if (!(await copyHostPathToWorkspace(join(packageRoot, 'docs'), workspace, posix.join(target, 'docs')))) {
      await copyHostPathToWorkspace(join(packageRoot, 'src', 'server', 'docs'), workspace, posix.join(target, 'docs'))
    }
    await copyHostPathToWorkspace(join(packageRoot, 'skills'), workspace, posix.join(target, 'skills'))
    await copyHostPathToWorkspace(join(packageRoot, 'references'), workspace, posix.join(target, 'references'))
    await copyHostPathToWorkspace(join(packageRoot, 'src', 'globals.css'), workspace, posix.join(target, 'src', 'globals.css'))
  }
}

function remotePythonProjectTarget(spec: RuntimePythonSpec): string {
  const safeId = spec.id.replace(/[^A-Za-z0-9._-]/g, '_') || 'python'
  return posix.join(BORING_AGENT_DIR, 'sdk', 'python', safeId)
}

async function ensureRemotePython(
  workspace: Workspace,
  sandbox: Sandbox,
  runtimeCwd: string,
  specs: RuntimePythonSpec[],
): Promise<void> {
  if (specs.length === 0) return
  const venv = `${runtimeCwd}/${BORING_AGENT_DIR}/venv`
  const venvPython = `${venv}/bin/python`
  const uv = await sandboxCommandExists(sandbox, 'uv', runtimeCwd)

  for (const spec of specs) {
    await copyHostPathToWorkspace(dirname(toPath(spec.projectFile)), workspace, remotePythonProjectTarget(spec))
  }

  if (!(await workspaceExists(workspace, `${BORING_AGENT_DIR}/venv/bin/python`))) {
    if (uv) await sandboxRun(sandbox, `uv venv --allow-existing ${shellQuote(venv)}`, runtimeCwd)
    else await sandboxRun(sandbox, `/usr/bin/python3 -m venv ${shellQuote(venv)}`, runtimeCwd)
  }

  for (const spec of specs) {
    const projectDir = `${runtimeCwd}/${remotePythonProjectTarget(spec)}`
    if (uv) {
      await sandboxRun(sandbox, `uv pip install --python ${shellQuote(venvPython)} ${shellQuote(projectDir)}`, runtimeCwd)
      if (spec.extraLibs?.length) {
        await sandboxRun(sandbox, `uv pip install --python ${shellQuote(venvPython)} ${spec.extraLibs.map(shellQuote).join(' ')}`, runtimeCwd)
      }
    } else {
      await sandboxRun(sandbox, `${shellQuote(venvPython)} -m pip install ${shellQuote(projectDir)}`, runtimeCwd)
      if (spec.extraLibs?.length) await sandboxRun(sandbox, `${shellQuote(venvPython)} -m pip install ${spec.extraLibs.map(shellQuote).join(' ')}`, runtimeCwd)
    }
  }
}

async function isRemoteRuntimeMaterialized(
  workspace: Workspace,
  contributions: Array<{ provisioning: RuntimeProvisioningContribution }>,
): Promise<boolean> {
  const hasPython = contributions.some(({ provisioning }) => (provisioning.python ?? []).length > 0)
  if (hasPython && !(await workspaceExists(workspace, `${BORING_AGENT_DIR}/venv/bin/python`))) return false
  for (const { provisioning } of contributions) {
    for (const spec of provisioning.nodePackages ?? []) {
      if (!(await workspaceExists(workspace, posix.join(nodePackageTargetRel(spec.packageName), 'package.json')))) return false
    }
  }
  return true
}

async function writeRemoteExecutable(
  workspace: Workspace,
  sandbox: Sandbox,
  runtimeCwd: string,
  relPath: string,
  body: string,
): Promise<void> {
  await workspace.writeFile(relPath, body)
  await sandboxRun(sandbox, `chmod +x ${shellQuote(`${runtimeCwd}/${relPath}`)}`, runtimeCwd)
}

async function writeRemoteShims(
  workspace: Workspace,
  sandbox: Sandbox,
  runtimeCwd: string,
  env: Record<string, string>,
): Promise<string> {
  const shimDir = `${BORING_AGENT_DIR}/bin`
  const venvBin = `${BORING_AGENT_DIR}/venv/bin`
  await workspace.mkdir(shimDir, { recursive: true })
  const base = buildShimBase(env)

  await writeRemoteExecutable(workspace, sandbox, runtimeCwd, `${shimDir}/python`, `${base}exec "$VENV_BIN/python" "$@"\n`)
  await writeRemoteExecutable(workspace, sandbox, runtimeCwd, `${shimDir}/python3`, `${base}exec "$VENV_BIN/python" "$@"\n`)
  await writeRemoteExecutable(workspace, sandbox, runtimeCwd, `${shimDir}/pip`, `${base}exec "$VENV_BIN/python" -m pip "$@"\n`)
  await writeRemoteExecutable(workspace, sandbox, runtimeCwd, `${shimDir}/pip3`, `${base}exec "$VENV_BIN/python" -m pip "$@"\n`)

  if (await workspaceExists(workspace, venvBin)) {
    for (const entry of await workspace.readdir(venvBin)) {
      if (['python', 'python3', 'pip', 'pip3'].includes(entry.name) || entry.kind !== 'file') continue
      const relPath = `${shimDir}/${entry.name}`
      await writeRemoteExecutable(workspace, sandbox, runtimeCwd, relPath, `${base}TARGET="$VENV_BIN"/${bashSingleQuote(entry.name)}
SHEBANG="$(head -n 1 "$TARGET" 2>/dev/null || true)"
case "$SHEBANG" in
  *python*) exec "$VENV_BIN/python" "$TARGET" "$@" ;;
esac
exec "$TARGET" "$@"
`)
    }
  }
  return `${runtimeCwd}/${shimDir}`
}

async function validateRuntimeInSandbox(
  sandbox: Sandbox,
  runtimeCwd: string,
  contributions: Array<{ provisioning: RuntimeProvisioningContribution }>,
): Promise<void> {
  const checks = [
    `${BORING_AGENT_PROVISIONING_MARKER_REL_PATH}`,
    `${BORING_AGENT_DIR}/bin/python`,
    `${BORING_AGENT_DIR}/state/${BORING_AGENT_OWNERSHIP_MARKER_FILENAME}`,
  ]
  if (contributions.some(({ provisioning }) => (provisioning.python ?? []).length > 0)) {
    checks.push(`${BORING_AGENT_DIR}/venv/bin/python`)
  }
  for (const { provisioning } of contributions) {
    for (const spec of provisioning.nodePackages ?? []) {
      checks.push(posix.join(nodePackageTargetRel(spec.packageName), 'package.json'))
    }
  }
  await sandboxRun(sandbox, checks.map((path) => `test -e ${shellQuote(path)}`).join(' && '), runtimeCwd)
}

async function provisionRemoteRuntimeWorkspace(
  opts: ProvisionRuntimeWorkspaceOptions,
  target: ProvisionTarget,
  active: Array<{ id: string; provisioning: RuntimeProvisioningContribution }>,
  env: Record<string, string>,
  hash: string,
): Promise<RuntimeWorkspaceProvisioningResult> {
  if (!opts.workspace || !opts.sandbox) throw new Error('Remote provisioning requires workspace and sandbox')
  const workspace = opts.workspace
  const sandbox = opts.sandbox

  await ensureRemoteRuntimeLayout(workspace)
  const markerPath = BORING_AGENT_PROVISIONING_MARKER_REL_PATH
  const legacyMarkerPath = BORING_AGENT_LEGACY_PROVISIONING_MARKER_REL_PATH

  if (!opts.force) {
    const markerResult = await workspaceReadJsonMarker(workspace, markerPath, legacyMarkerPath)
    if (markerResult?.marker.fingerprint === hash && await isRemoteRuntimeMaterialized(workspace, active)) {
      const binDir = await writeRemoteShims(workspace, sandbox, target.runtimeCwd, env)
      if (markerResult.source === 'legacy') await workspace.writeFile(markerPath, provisioningMarkerBody(hash, target))
      await validateRuntimeInSandbox(sandbox, target.runtimeCwd, active)
      return { fingerprint: hash, changed: false, env, binDir }
    }
  }

  await seedRemoteTemplates(workspace, active)
  await ensureRemoteNodePackages(workspace, active.flatMap(({ provisioning }) => provisioning.nodePackages ?? []))
  await ensureRemotePython(workspace, sandbox, target.runtimeCwd, active.flatMap(({ provisioning }) => provisioning.python ?? []))
  const binDir = await writeRemoteShims(workspace, sandbox, target.runtimeCwd, env)
  await workspace.writeFile(markerPath, provisioningMarkerBody(hash, target))
  await validateRuntimeInSandbox(sandbox, target.runtimeCwd, active)
  return { fingerprint: hash, changed: true, env, binDir }
}

export async function provisionRuntimeWorkspace(opts: ProvisionRuntimeWorkspaceOptions): Promise<RuntimeWorkspaceProvisioningResult> {
  const active: Array<{ id: string; provisioning: RuntimeProvisioningContribution }> = []
  for (const contribution of opts.contributions ?? []) {
    if (contribution.provisioning) active.push({ id: contribution.id, provisioning: contribution.provisioning })
  }

  const target = resolveTarget(opts)
  const env = collectEnv(active, target)
  const hash = await fingerprint(active, target)

  if (opts.sandbox?.placement === 'remote') {
    return await provisionRemoteRuntimeWorkspace(opts, target, active, env, hash)
  }

  return await provisionHostRuntimeWorkspace(opts, target, active, env, hash)
}
