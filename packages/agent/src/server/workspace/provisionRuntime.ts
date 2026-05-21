import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RuntimeModeId } from '../runtime/mode'
import type { Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'
import { getEnvSnapshot } from '../config/env'
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
export const RUNTIME_PROVISIONING_VERSION = 6
const PROVISIONING_VERSION = RUNTIME_PROVISIONING_VERSION
const DEFAULT_REMOTE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_REMOTE_MAX_OUTPUT_BYTES = 1024 * 1024 * 20
const NODE_PACKAGE_LOCK_FILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]

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
  /** Package name materialized under .boring-agent/node/node_modules, e.g. @boring/workspace. */
  packageName: string
  /** npm package version/dist-tag for registry-backed provisioning. */
  version?: string
  /** Source package root. The provisioner copies the built package payload into node_modules. */
  packageRoot?: string | URL
  /** Runtime bin aliases mapped to package-relative executable paths. */
  bins?: Record<string, string>
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

function optionalPathToString(value: string | URL | undefined): string {
  if (value === undefined) return ''
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

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message)
}

function isFileUrl(value: unknown): value is URL {
  return value instanceof URL && value.protocol === 'file:'
}

function assertValidPackageName(packageName: string, context: string): void {
  if (packageName.trim() !== packageName || packageName.includes('\0') || packageName.includes('\\')) {
    throw new Error(`${context}.packageName must be a valid npm package name`)
  }
  const parts = packageName.split('/')
  const validPart = (part: string) => part.length > 0 && part !== '.' && part !== '..' && !part.includes('\0')
  if (packageName.startsWith('@')) {
    if (parts.length !== 2 || !parts[0].startsWith('@') || !validPart(parts[0].slice(1)) || !validPart(parts[1])) {
      throw new Error(`${context}.packageName must be a valid scoped npm package name`)
    }
    return
  }
  if (parts.length !== 1 || !validPart(parts[0])) {
    throw new Error(`${context}.packageName must be a valid npm package name`)
  }
}

function assertValidPackageRoot(packageRoot: unknown, context: string): asserts packageRoot is string | URL | undefined {
  if (packageRoot === undefined) return
  if (typeof packageRoot === 'string') {
    if (packageRoot.length === 0 || packageRoot.includes('\0')) {
      throw new Error(`${context}.packageRoot must be a non-empty string or file URL when provided`)
    }
    return
  }
  if (!isFileUrl(packageRoot)) {
    throw new Error(`${context}.packageRoot must be a non-empty string or file URL when provided`)
  }
}

function assertValidPackageVersion(version: unknown, context: string): asserts version is string | undefined {
  if (version === undefined) return
  if (typeof version !== 'string' || version.length === 0 || version.trim() !== version || /[\s\0]/.test(version)) {
    throw new Error(`${context}.version must be a non-empty version string when provided`)
  }
}

function normalizePackageRelativePath(path: string, context: string): string {
  if (path.length === 0 || path.includes('\0') || path.includes('\\')) {
    throw new Error(`${context} must be a package-relative file path`)
  }
  const normalized = posix.normalize(path.replace(/^\.\//, ''))
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..' || posix.isAbsolute(normalized)) {
    throw new Error(`${context} must be a package-relative file path`)
  }
  return normalized
}

function assertValidBinName(name: string, context: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`${context} must be a bin name without path separators`)
  }
}

function normalizeBins(bins: Record<string, string> | undefined, context: string): Record<string, string> | undefined {
  if (bins === undefined) return undefined
  if (!bins || typeof bins !== 'object' || Array.isArray(bins)) {
    throw new Error(`${context}.bins must be an object mapping bin names to package-relative paths when provided`)
  }
  const normalized: Record<string, string> = {}
  for (const [name, target] of Object.entries(bins)) {
    assertValidBinName(name, `${context}.bins key "${name}"`)
    assertNonEmptyString(target, `${context}.bins.${name} must be a package-relative file path`)
    normalized[name] = normalizePackageRelativePath(target, `${context}.bins.${name}`)
  }
  return normalized
}

function unscopedPackageName(packageName: string): string {
  const parts = packageName.split('/')
  return parts[parts.length - 1] || packageName
}

function parsePackageJsonBins(packageJson: unknown, spec: RuntimeNodePackageSpec, context: string): Record<string, string> {
  const candidate = packageJson as { bin?: unknown } | null
  const bin = candidate?.bin
  if (bin === undefined) return {}
  if (typeof bin === 'string') {
    return { [unscopedPackageName(spec.packageName)]: normalizePackageRelativePath(bin, `${context} package.json bin`) }
  }
  if (!bin || typeof bin !== 'object' || Array.isArray(bin)) {
    throw new Error(`${context} package.json bin must be a string or object when present`)
  }
  const bins: Record<string, string> = {}
  for (const [name, target] of Object.entries(bin)) {
    assertValidBinName(name, `${context} package.json bin key "${name}"`)
    assertNonEmptyString(target, `${context} package.json bin.${name} must be a package-relative file path`)
    bins[name] = normalizePackageRelativePath(target, `${context} package.json bin.${name}`)
  }
  return bins
}

async function readNodePackageJson(packageRoot: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
}

async function collectNodePackageBinNames(spec: RuntimeNodePackageSpec, context: string): Promise<string[]> {
  const explicitBins = normalizeBins(spec.bins, context)
  if (explicitBins) return Object.keys(explicitBins)
  if (!spec.packageRoot) return []
  const packageJson = await readNodePackageJson(toPath(spec.packageRoot))
  if (!packageJson) return []
  return Object.keys(parsePackageJsonBins(packageJson, spec, context))
}

async function collectNodePackageBinTargets(spec: RuntimeNodePackageSpec, context: string): Promise<string[]> {
  const explicitBins = normalizeBins(spec.bins, context)
  if (explicitBins) return Object.values(explicitBins)
  if (!spec.packageRoot) return []
  const packageJson = await readNodePackageJson(toPath(spec.packageRoot))
  if (!packageJson) return []
  return Object.values(parsePackageJsonBins(packageJson, spec, context))
}

export async function validateRuntimeProvisioningContributions(
  contributions: Array<{ id: string; provisioning?: RuntimeProvisioningContribution }>,
): Promise<void> {
  const binOwners = new Map<string, string>()
  for (let contributionIndex = 0; contributionIndex < contributions.length; contributionIndex++) {
    const contribution = contributions[contributionIndex]
    if (!contribution.provisioning) continue
    const specs = contribution.provisioning.nodePackages
    if (specs === undefined) continue
    if (!Array.isArray(specs)) throw new Error(`contributions[${contributionIndex}].provisioning.nodePackages must be an array when provided`)
    for (let specIndex = 0; specIndex < specs.length; specIndex++) {
      const spec = specs[specIndex] as RuntimeNodePackageSpec
      const context = `contributions[${contributionIndex}].provisioning.nodePackages[${specIndex}]`
      if (!spec || typeof spec !== 'object') throw new Error(`${context} must be an object`)
      assertNonEmptyString(spec.id, `${context}.id must be a non-empty string`)
      assertNonEmptyString(spec.packageName, `${context}.packageName must be a non-empty string`)
      assertValidPackageName(spec.packageName, context)
      assertValidPackageVersion(spec.version, context)
      assertValidPackageRoot(spec.packageRoot, context)
      normalizeBins(spec.bins, context)
      if (!spec.packageRoot && !spec.version) {
        throw new Error(`${context} must provide packageRoot for a local source or version for a registry source`)
      }
      if (spec.packageRoot) {
        const packageJson = await readNodePackageJson(toPath(spec.packageRoot))
        if (!packageJson) throw new Error(`Node package provisioning source is missing package.json: ${toPath(spec.packageRoot)}`)
      }
      const owner = `${contribution.id}:${spec.id}`
      for (const binName of await collectNodePackageBinNames(spec, context)) {
        const previous = binOwners.get(binName)
        if (previous) {
          throw new Error(`Duplicate node package bin "${binName}" from ${owner} conflicts with ${previous}; set nodePackages[].bins aliases to disambiguate`)
        }
        binOwners.set(binName, owner)
      }
    }
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

async function run(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  await execFileAsync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 1024 * 1024 * 20,
    timeout: 5 * 60 * 1000,
  })
}

async function runOutput(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const result = await execFileAsync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 1024 * 1024 * 20,
    timeout: 5 * 60 * 1000,
  })
  return String(result.stdout)
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
      const packageRoot = optionalPathToString(spec.packageRoot)
      hash.update(`${JSON.stringify({
        type: 'node-package',
        id: spec.id,
        packageName: spec.packageName,
        version: spec.version ?? '',
        packageRoot,
        bins: Object.fromEntries(Object.entries(normalizeBins(spec.bins, `nodePackages.${spec.id}`) ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      })}\n`)
      if (!spec.packageRoot) continue
      const packageJson = join(packageRoot, 'package.json')
      const distDir = join(packageRoot, 'dist')
      const docsDir = join(packageRoot, 'docs')
      const skillsDir = join(packageRoot, 'skills')
      const referencesDir = join(packageRoot, 'references')
      const sourceDocsDir = join(packageRoot, 'src', 'server', 'docs')
      if (await exists(packageJson)) await hashPath(packageJson, hash)
      for (const target of await collectNodePackageBinTargets(spec, `nodePackages.${spec.id}`)) {
        const targetPath = join(packageRoot, target)
        if (await exists(targetPath)) await hashPath(targetPath, hash)
      }
      for (const lockFile of NODE_PACKAGE_LOCK_FILES) {
        const lockPath = join(packageRoot, lockFile)
        if (await exists(lockPath)) await hashPath(lockPath, hash)
      }
      const rootEntries = (await readdir(packageRoot).catch(() => []))
        .filter((entry) => entry.endsWith('.tgz') || entry.endsWith('.tar.gz'))
        .sort()
      for (const entry of rootEntries) await hashPath(join(packageRoot, entry), hash)
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

interface NodeBinLink {
  name: string
  packageName: string
  targetRel: string
}

const NODE_BIN_MANIFEST_REL_PATH = `${BORING_AGENT_DIR}/state/node-bins.json`

function nodeCacheEnv(paths: ReturnType<typeof getBoringAgentRuntimePaths>): Record<string, string> {
  return {
    npm_config_cache: join(paths.cache, 'node'),
    npm_config_update_notifier: 'false',
  }
}

function npmInstallArgs(prefix: string, cacheDir: string, sources: string[]): string[] {
  return [
    'install',
    '--prefix', prefix,
    '--cache', cacheDir,
    '--no-audit',
    '--no-fund',
    '--no-save',
    '--install-strategy=shallow',
    ...sources,
  ]
}

function remoteNpmInstallCommand(prefix: string, cacheDir: string, sources: string[]): string {
  return `npm install ${npmInstallArgs(prefix, cacheDir, sources).slice(1).map(shellQuote).join(' ')}`
}

function registryNodePackageSource(spec: RuntimeNodePackageSpec): string {
  return `${spec.packageName}@${spec.version ?? 'latest'}`
}

function parseNpmPackOutput(stdout: string, packDestination: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('npm pack did not report a tarball')
  try {
    const parsed = JSON.parse(trimmed) as { filename?: unknown } | Array<{ filename?: unknown }>
    const filename = Array.isArray(parsed)
      ? parsed.find((entry) => typeof entry.filename === 'string')?.filename
      : parsed.filename
    if (typeof filename === 'string' && filename.length > 0) {
      return isAbsolute(filename) ? filename : join(packDestination, filename)
    }
  } catch {
    // Older npm versions may print a plain tarball filename.
  }
  const filename = trimmed.split(/\r?\n/).reverse().find((line) => line.endsWith('.tgz'))
  if (!filename) throw new Error(`npm pack did not report a tarball: ${trimmed}`)
  return isAbsolute(filename) ? filename : join(packDestination, filename)
}

function safeNodeArtifactPrefix(spec: RuntimeNodePackageSpec): string {
  return `${spec.id || unscopedPackageName(spec.packageName)}`.replace(/[^A-Za-z0-9._-]/g, '_') || 'node-package'
}

async function packLocalNodePackage(packageRoot: string, packDestination: string, cwd: string, cacheDir: string): Promise<string> {
  await mkdir(packDestination, { recursive: true })
  if (await commandExists('pnpm')) {
    const stdout = await runOutput('pnpm', [
      '--dir', packageRoot,
      'pack',
      '--pack-destination', packDestination,
      '--json',
    ], cwd, { npm_config_cache: cacheDir, npm_config_update_notifier: 'false' })
    return parseNpmPackOutput(stdout, packDestination)
  }
  const stdout = await runOutput('npm', [
    'pack',
    packageRoot,
    '--pack-destination', packDestination,
    '--json',
    '--cache', cacheDir,
  ], cwd, { npm_config_cache: cacheDir, npm_config_update_notifier: 'false' })
  return parseNpmPackOutput(stdout, packDestination)
}

async function hostNodeInstallSource(workspaceRoot: string, spec: RuntimeNodePackageSpec): Promise<string> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const cacheDir = join(paths.cache, 'node')
  if (!spec.packageRoot) return registryNodePackageSource(spec)
  return await packLocalNodePackage(
    toPath(spec.packageRoot),
    await mkdtemp(join(paths.tmp, `${safeNodeArtifactPrefix(spec)}-`)),
    workspaceRoot,
    cacheDir,
  )
}

function nodeBinShimBody(targetRel: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
export BORING_AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"
export PATH="$WORKSPACE_ROOT/.boring-agent/bin:$WORKSPACE_ROOT/.boring-agent/venv/bin\${PATH:+:$PATH}"
TARGET="$WORKSPACE_ROOT"/${bashSingleQuote(targetRel)}
SHEBANG="$(head -n 1 "$TARGET" 2>/dev/null || true)"
case "$SHEBANG" in
  *node*) exec node "$TARGET" "$@" ;;
esac
if [ -x "$TARGET" ]; then
  exec "$TARGET" "$@"
fi
exec node "$TARGET" "$@"
`
}

function nodePackageBinLinksFromPackageJson(
  spec: RuntimeNodePackageSpec,
  packageJson: unknown,
  context: string,
): NodeBinLink[] {
  const bins = normalizeBins(spec.bins, context) ?? parsePackageJsonBins(packageJson, spec, context)
  return Object.entries(bins).map(([name, target]) => ({
    name,
    packageName: spec.packageName,
    targetRel: posix.join(nodePackageTargetRel(spec.packageName), target),
  }))
}

function parseNodeBinManifest(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { bins?: Array<{ name?: unknown }> }
    if (!Array.isArray(parsed.bins)) return []
    return parsed.bins
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..')
  } catch {
    return []
  }
}

function nodeBinManifestBody(links: NodeBinLink[]): string {
  return `${JSON.stringify({
    v: 1,
    bins: links.map((link) => ({ name: link.name, packageName: link.packageName, targetRel: link.targetRel }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }, null, 2)}\n`
}

async function collectHostNodeBinLinks(workspaceRoot: string, specs: RuntimeNodePackageSpec[]): Promise<NodeBinLink[]> {
  const links: NodeBinLink[] = []
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    const target = nodePackageTarget(workspaceRoot, spec.packageName)
    const packageJson = await readNodePackageJson(target) ?? (spec.packageRoot ? await readNodePackageJson(toPath(spec.packageRoot)) : null)
    if (!packageJson) throw new Error(`Provisioned node package is missing package.json: ${target}`)
    links.push(...nodePackageBinLinksFromPackageJson(spec, packageJson, `nodePackages.${spec.id || i}`))
  }
  return links
}

async function writeHostNodeBinLinks(workspaceRoot: string, specs: RuntimeNodePackageSpec[]): Promise<void> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  await mkdir(paths.bin, { recursive: true })
  await mkdir(paths.state, { recursive: true })
  const links = await collectHostNodeBinLinks(workspaceRoot, specs)
  const desired = new Set(links.map((link) => link.name))
  const manifestPath = join(workspaceRoot, NODE_BIN_MANIFEST_REL_PATH)
  if (await exists(manifestPath)) {
    for (const name of parseNodeBinManifest(await readFile(manifestPath, 'utf8'))) {
      if (!desired.has(name)) await rm(join(paths.bin, name), { force: true })
    }
  }
  for (const link of links) {
    await writeExecutable(join(paths.bin, link.name), nodeBinShimBody(link.targetRel))
  }
  await writeFile(manifestPath, nodeBinManifestBody(links), 'utf8')
}

async function ensureNodePackages(workspaceRoot: string, specs: RuntimeNodePackageSpec[]): Promise<void> {
  if (specs.length === 0) return
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const cacheDir = join(paths.cache, 'node')
  await mkdir(paths.node, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await mkdir(paths.tmp, { recursive: true })
  const sources = await Promise.all(specs.map((spec) => hostNodeInstallSource(workspaceRoot, spec)))
  await run('npm', npmInstallArgs(paths.node, cacheDir, sources), workspaceRoot, nodeCacheEnv(paths))
}

function pythonCacheEnv(paths: ReturnType<typeof getBoringAgentRuntimePaths>): Record<string, string> {
  const cacheDir = join(paths.cache, 'python')
  return {
    UV_CACHE_DIR: cacheDir,
    PIP_CACHE_DIR: cacheDir,
  }
}

async function recreatePythonVenv(workspaceRoot: string): Promise<void> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  await mkdir(paths.tmp, { recursive: true })
  await mkdir(join(paths.cache, 'python'), { recursive: true })
  const stagedVenv = await mkdtemp(join(paths.tmp, 'venv-'))
  const env = pythonCacheEnv(paths)
  try {
    // Build the interpreter tree under tmp first, then install packages only
    // after the move so generated console-script shebangs point at
    // .boring-agent/venv rather than a transient staging path.
    await run('python3', ['-m', 'venv', '--copies', stagedVenv], workspaceRoot, env)
    await rm(paths.venv, { recursive: true, force: true })
    await rename(stagedVenv, paths.venv)
    await writeBoringAgentOwnershipMarker(paths.venv, '.boring-agent/venv')
  } catch (error) {
    await rm(stagedVenv, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function ensurePython(workspaceRoot: string, specs: RuntimePythonSpec[]): Promise<void> {
  if (specs.length === 0) return
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const venvPython = paths.venvPython
  const env = pythonCacheEnv(paths)
  const uv = await commandExists('uv')

  await recreatePythonVenv(workspaceRoot)

  for (const spec of specs) {
    const projectDir = dirname(toPath(spec.projectFile))
    if (uv) {
      await run('uv', ['pip', 'install', '--python', venvPython, projectDir], workspaceRoot, env)
      if (spec.extraLibs?.length) {
        await run('uv', ['pip', 'install', '--python', venvPython, ...spec.extraLibs], workspaceRoot, env)
      }
    } else {
      await run(venvPython, ['-m', 'pip', 'install', projectDir], workspaceRoot, env)
      if (spec.extraLibs?.length) await run(venvPython, ['-m', 'pip', 'install', ...spec.extraLibs], workspaceRoot, env)
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

function hasPythonContributions(contributions: Array<{ provisioning: RuntimeProvisioningContribution }>): boolean {
  return contributions.some(({ provisioning }) => (provisioning.python ?? []).length > 0)
}

async function isHostPythonUsable(workspaceRoot: string): Promise<boolean> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  if (!(await exists(paths.venvPython))) return false
  try {
    await run(paths.venvPython, ['-c', 'import sys; raise SystemExit(0 if sys.executable else 1)'], workspaceRoot, pythonCacheEnv(paths))
    await run(paths.venvPython, ['-m', 'pip', '--version'], workspaceRoot, pythonCacheEnv(paths))
    return true
  } catch {
    return false
  }
}

async function isRuntimeMaterialized(
  workspaceRoot: string,
  contributions: Array<{ provisioning: RuntimeProvisioningContribution }>,
): Promise<boolean> {
  if (hasPythonContributions(contributions) && !(await isHostPythonUsable(workspaceRoot))) return false
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

async function validateHostRuntime(
  workspaceRoot: string,
  contributions: Array<{ provisioning: RuntimeProvisioningContribution }>,
): Promise<void> {
  if (!hasPythonContributions(contributions)) return
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const env = {
    ...pythonCacheEnv(paths),
    PATH: `${paths.bin}:${paths.venvBin}${getEnvSnapshot().PATH ? `:${getEnvSnapshot().PATH}` : ''}`,
    VIRTUAL_ENV: paths.venv,
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
  }
  await run('python', ['--version'], workspaceRoot, env)
  await run('python3', ['--version'], workspaceRoot, env)
  await run('pip', ['--version'], workspaceRoot, env)
  await run('pip3', ['--version'], workspaceRoot, env)
  await run(paths.venvPython, ['-c', 'import sys; raise SystemExit(0 if sys.executable else 1)'], workspaceRoot, env)
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

  if (!opts.force) {
    const markerResult = await readProvisioningMarker(markerPath, legacyMarkerPath)
    if (markerResult?.marker.fingerprint === hash && await isRuntimeMaterialized(workspaceRoot, active)) {
      const actualBinDir = await writeShims(workspaceRoot, env)
      await writeHostNodeBinLinks(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.nodePackages ?? []))
      try {
        await validateHostRuntime(workspaceRoot, active)
        if (markerResult.source === 'legacy') await writeProvisioningMarker(markerPath, hash, target)
        if (opts.sandbox && target.runtimeMode === 'local') await validateRuntimeInSandbox(opts.sandbox, target.runtimeCwd, active)
        return { fingerprint: hash, changed: false, env, binDir: actualBinDir }
      } catch (error) {
        if (!hasPythonContributions(active)) throw error
        // Matching state with a broken Python runtime is rebuilt below.
      }
    }
  }

  await seedTemplates(workspaceRoot, active)
  const nodePackageSpecs = active.flatMap(({ provisioning }) => provisioning.nodePackages ?? [])
  await ensureNodePackages(workspaceRoot, nodePackageSpecs)
  await ensurePython(workspaceRoot, active.flatMap(({ provisioning }) => provisioning.python ?? []))
  const actualBinDir = await writeShims(workspaceRoot, env)
  await writeHostNodeBinLinks(workspaceRoot, nodePackageSpecs)
  await validateHostRuntime(workspaceRoot, active)
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

async function packLocalNodePackageForRemote(
  storageRoot: string,
  spec: RuntimeNodePackageSpec,
): Promise<{ tarballPath: string; cleanup: () => Promise<void> }> {
  if (!spec.packageRoot) throw new Error(`Node package ${spec.packageName} has no packageRoot to pack`)
  const packDestination = await mkdtemp(join(tmpdir(), `${safeNodeArtifactPrefix(spec)}-`))
  const cacheDir = await mkdtemp(join(tmpdir(), `${safeNodeArtifactPrefix(spec)}-npm-cache-`))
  await mkdir(storageRoot, { recursive: true })
  try {
    const tarballPath = await packLocalNodePackage(toPath(spec.packageRoot), packDestination, storageRoot, cacheDir)
    return {
      tarballPath,
      cleanup: async () => {
        await rm(packDestination, { recursive: true, force: true })
        await rm(cacheDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(packDestination, { recursive: true, force: true }).catch(() => undefined)
    await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function remoteNodeInstallSource(
  workspace: Workspace,
  storageRoot: string,
  spec: RuntimeNodePackageSpec,
): Promise<{ source: string; cleanup?: () => Promise<void> }> {
  if (!spec.packageRoot) return { source: registryNodePackageSource(spec) }
  const packed = await packLocalNodePackageForRemote(storageRoot, spec)
  const remoteTarballRel = posix.join(BORING_AGENT_DIR, 'tmp', `${safeNodeArtifactPrefix(spec)}-${basename(packed.tarballPath)}`)
  await copyHostPathToWorkspace(packed.tarballPath, workspace, remoteTarballRel)
  return { source: remoteTarballRel, cleanup: packed.cleanup }
}

async function ensureRemoteNodePackages(
  workspace: Workspace,
  sandbox: Sandbox,
  runtimeCwd: string,
  storageRoot: string,
  specs: RuntimeNodePackageSpec[],
): Promise<void> {
  await workspace.mkdir(posix.join(BORING_AGENT_DIR, 'cache', 'node'), { recursive: true })
  await workspace.mkdir(posix.join(BORING_AGENT_DIR, 'tmp'), { recursive: true })
  await workspace.mkdir(posix.join(BORING_AGENT_DIR, 'node'), { recursive: true })
  const sources: string[] = []
  const cleanups: Array<() => Promise<void>> = []
  for (const spec of specs) {
    const installSource = await remoteNodeInstallSource(workspace, storageRoot, spec)
    sources.push(spec.packageRoot ? `${runtimeCwd}/${installSource.source}` : installSource.source)
    if (installSource.cleanup) cleanups.push(installSource.cleanup)
  }
  try {
    if (sources.length > 0) {
      await sandboxRun(sandbox, remoteNpmInstallCommand(
        `${runtimeCwd}/${BORING_AGENT_DIR}/node`,
        `${runtimeCwd}/${BORING_AGENT_DIR}/cache/node`,
        sources,
      ), runtimeCwd)
    }
  } finally {
    await Promise.all(cleanups.map((cleanup) => cleanup()))
  }
}

function remotePythonProjectTarget(spec: RuntimePythonSpec): string {
  const safeId = spec.id.replace(/[^A-Za-z0-9._-]/g, '_') || 'python'
  return posix.join(BORING_AGENT_DIR, 'sdk', 'python', safeId)
}

function remotePythonCachePrefix(runtimeCwd: string): string {
  const cacheDir = `${runtimeCwd}/${BORING_AGENT_DIR}/cache/python`
  return `UV_CACHE_DIR=${shellQuote(cacheDir)} PIP_CACHE_DIR=${shellQuote(cacheDir)}`
}

async function recreateRemotePythonVenv(
  workspace: Workspace,
  sandbox: Sandbox,
  runtimeCwd: string,
): Promise<void> {
  const venv = `${runtimeCwd}/${BORING_AGENT_DIR}/venv`
  const tmpName = `venv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const stagedVenvRel = posix.join(BORING_AGENT_DIR, 'tmp', tmpName)
  const stagedVenv = `${runtimeCwd}/${stagedVenvRel}`
  await workspace.mkdir(posix.join(BORING_AGENT_DIR, 'cache', 'python'), { recursive: true })
  await workspace.mkdir(posix.join(BORING_AGENT_DIR, 'tmp'), { recursive: true })
  try {
    // Stage the interpreter tree but install packages after the move so remote
    // console-script shebangs reference .boring-agent/venv, not tmp.
    await sandboxRun(sandbox, `${remotePythonCachePrefix(runtimeCwd)} python3 -m venv --copies ${shellQuote(stagedVenv)}`, runtimeCwd)
    await sandboxRun(sandbox, `rm -rf -- ${shellQuote(venv)} && mv -- ${shellQuote(stagedVenv)} ${shellQuote(venv)}`, runtimeCwd)
    await workspace.writeFile(
      posix.join(BORING_AGENT_DIR, 'venv', BORING_AGENT_OWNERSHIP_MARKER_FILENAME),
      `${JSON.stringify({
        v: BORING_AGENT_OWNERSHIP_MARKER_VERSION,
        owner: BORING_AGENT_OWNER,
        path: `${BORING_AGENT_DIR}/venv`,
        kind: 'runtime-dir',
      }, null, 2)}\n`,
    )
  } catch (error) {
    await sandboxRun(sandbox, `rm -rf -- ${shellQuote(stagedVenv)}`, runtimeCwd).catch(() => undefined)
    throw error
  }
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

  await recreateRemotePythonVenv(workspace, sandbox, runtimeCwd)

  for (const spec of specs) {
    const projectDir = `${runtimeCwd}/${remotePythonProjectTarget(spec)}`
    if (uv) {
      await sandboxRun(sandbox, `${remotePythonCachePrefix(runtimeCwd)} uv pip install --python ${shellQuote(venvPython)} ${shellQuote(projectDir)}`, runtimeCwd)
      if (spec.extraLibs?.length) {
        await sandboxRun(sandbox, `${remotePythonCachePrefix(runtimeCwd)} uv pip install --python ${shellQuote(venvPython)} ${spec.extraLibs.map(shellQuote).join(' ')}`, runtimeCwd)
      }
    } else {
      await sandboxRun(sandbox, `${remotePythonCachePrefix(runtimeCwd)} ${shellQuote(venvPython)} -m pip install ${shellQuote(projectDir)}`, runtimeCwd)
      if (spec.extraLibs?.length) await sandboxRun(sandbox, `${remotePythonCachePrefix(runtimeCwd)} ${shellQuote(venvPython)} -m pip install ${spec.extraLibs.map(shellQuote).join(' ')}`, runtimeCwd)
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

async function readRemoteNodePackageJson(workspace: Workspace, spec: RuntimeNodePackageSpec): Promise<unknown | null> {
  const installedPath = posix.join(nodePackageTargetRel(spec.packageName), 'package.json')
  try {
    return JSON.parse(await workspace.readFile(installedPath))
  } catch {
    if (!spec.packageRoot) return null
    return await readNodePackageJson(toPath(spec.packageRoot))
  }
}

async function collectRemoteNodeBinLinks(workspace: Workspace, specs: RuntimeNodePackageSpec[]): Promise<NodeBinLink[]> {
  const links: NodeBinLink[] = []
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    const packageJson = await readRemoteNodePackageJson(workspace, spec)
    if (!packageJson) throw new Error(`Provisioned remote node package is missing package.json: ${nodePackageTargetRel(spec.packageName)}`)
    links.push(...nodePackageBinLinksFromPackageJson(spec, packageJson, `nodePackages.${spec.id || i}`))
  }
  return links
}

async function writeRemoteNodeBinLinks(
  workspace: Workspace,
  sandbox: Sandbox,
  runtimeCwd: string,
  specs: RuntimeNodePackageSpec[],
): Promise<void> {
  const shimDir = `${BORING_AGENT_DIR}/bin`
  await workspace.mkdir(shimDir, { recursive: true })
  await workspace.mkdir(posix.join(BORING_AGENT_DIR, 'state'), { recursive: true })
  const links = await collectRemoteNodeBinLinks(workspace, specs)
  const desired = new Set(links.map((link) => link.name))
  if (await workspaceExists(workspace, NODE_BIN_MANIFEST_REL_PATH)) {
    for (const name of parseNodeBinManifest(await workspace.readFile(NODE_BIN_MANIFEST_REL_PATH))) {
      if (!desired.has(name)) await workspace.unlink(posix.join(shimDir, name)).catch(() => undefined)
    }
  }
  for (const link of links) {
    await writeRemoteExecutable(workspace, sandbox, runtimeCwd, posix.join(shimDir, link.name), nodeBinShimBody(link.targetRel))
  }
  await workspace.writeFile(NODE_BIN_MANIFEST_REL_PATH, nodeBinManifestBody(links))
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
  const hasPython = hasPythonContributions(contributions)
  if (hasPython) {
    checks.push(`${BORING_AGENT_DIR}/venv/bin/python`)
  }
  for (const { provisioning } of contributions) {
    for (const spec of provisioning.nodePackages ?? []) {
      checks.push(posix.join(nodePackageTargetRel(spec.packageName), 'package.json'))
    }
  }
  await sandboxRun(sandbox, checks.map((path) => `test -e ${shellQuote(path)}`).join(' && '), runtimeCwd)
  if (!hasPython) return
  const venv = `${runtimeCwd}/${BORING_AGENT_DIR}/venv`
  const venvPython = `${venv}/bin/python`
  const pathPrefix = `${runtimeCwd}/${BORING_AGENT_DIR}/bin:${venv}/bin`
  await sandboxRun(sandbox, [
    `export VIRTUAL_ENV=${shellQuote(venv)}`,
    `export BORING_AGENT_WORKSPACE_ROOT=${shellQuote(runtimeCwd)}`,
    `export PATH=${shellQuote(pathPrefix)}:$PATH`,
    'python --version',
    'python3 --version',
    'pip --version',
    'pip3 --version',
    `test -x ${shellQuote(venvPython)}`,
    `${shellQuote(venvPython)} -c 'import sys; raise SystemExit(0 if sys.executable else 1)'`,
  ].join(' && '), runtimeCwd)
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
      const nodePackageSpecs = active.flatMap(({ provisioning }) => provisioning.nodePackages ?? [])
      const binDir = await writeRemoteShims(workspace, sandbox, target.runtimeCwd, env)
      await writeRemoteNodeBinLinks(workspace, sandbox, target.runtimeCwd, nodePackageSpecs)
      if (markerResult.source === 'legacy') await workspace.writeFile(markerPath, provisioningMarkerBody(hash, target))
      try {
        await validateRuntimeInSandbox(sandbox, target.runtimeCwd, active)
        return { fingerprint: hash, changed: false, env, binDir }
      } catch (error) {
        if (!hasPythonContributions(active)) throw error
        // Matching state with a broken remote Python runtime is rebuilt below.
      }
    }
  }

  const nodePackageSpecs = active.flatMap(({ provisioning }) => provisioning.nodePackages ?? [])
  await seedRemoteTemplates(workspace, active)
  await ensureRemoteNodePackages(workspace, sandbox, target.runtimeCwd, opts.storageRoot ?? opts.workspaceRoot, nodePackageSpecs)
  await ensureRemotePython(workspace, sandbox, target.runtimeCwd, active.flatMap(({ provisioning }) => provisioning.python ?? []))
  const binDir = await writeRemoteShims(workspace, sandbox, target.runtimeCwd, env)
  await writeRemoteNodeBinLinks(workspace, sandbox, target.runtimeCwd, nodePackageSpecs)
  await workspace.writeFile(markerPath, provisioningMarkerBody(hash, target))
  await validateRuntimeInSandbox(sandbox, target.runtimeCwd, active)
  return { fingerprint: hash, changed: true, env, binDir }
}

export async function provisionRuntimeWorkspace(opts: ProvisionRuntimeWorkspaceOptions): Promise<RuntimeWorkspaceProvisioningResult> {
  const active: Array<{ id: string; provisioning: RuntimeProvisioningContribution }> = []
  for (const contribution of opts.contributions ?? []) {
    if (contribution.provisioning) active.push({ id: contribution.id, provisioning: contribution.provisioning })
  }

  await validateRuntimeProvisioningContributions(active)

  const target = resolveTarget(opts)
  const env = collectEnv(active, target)
  const hash = await fingerprint(active, target)

  if (opts.sandbox?.placement === 'remote') {
    return await provisionRemoteRuntimeWorkspace(opts, target, active, env, hash)
  }

  return await provisionHostRuntimeWorkspace(opts, target, active, env, hash)
}
