import { createHash, type Hash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, stat as statPath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DefaultPackageManager, getAgentDir, type ResolvedPaths } from '@mariozechner/pi-coding-agent'
import { ErrorCode } from '../shared/error-codes'
import { AgentGatewayError, AgentGatewayErrorCode } from '../shared/gateway/errors'
import { compactPiPackages, type PiPackageSource } from './piPackages'
import { createResourceSettingsManager } from './harness/pi-coding-agent/resourceSettingsManager'

export interface PiResourceDigestLimits {
  readonly maxDepth: number
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
}

export const DEFAULT_PI_RESOURCE_DIGEST_LIMITS: PiResourceDigestLimits = Object.freeze({
  maxDepth: 32,
  maxFiles: 10_000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
})

export interface PiResourceDigestInput {
  /** Cwd passed to Pi. Explicit skills/extensions resolve from here. */
  readonly piCwd: string
  /** Pi user agent directory. User settings/package sources resolve from here. */
  readonly piAgentDir: string
  /** User home Pi uses for ~/.agents skill discovery. */
  readonly piUserHome: string
  /** Mirrors Pi's noSkills resource-loader option. */
  readonly noSkills: boolean
  readonly promptParts?: readonly (string | undefined)[]
  readonly additionalSkillPaths?: readonly string[]
  readonly packages?: readonly PiPackageSource[]
  readonly extensionPaths?: readonly string[]
  /** Lexical roots explicitly authorized by the embedding Workspace/CLI. */
  readonly authorizedRoots: readonly string[]
  /** CLI workspaces may contain repo-managed symlinks (e.g. .pi/skills/*). */
  readonly allowInternalSymlinks?: boolean
  /** When set, only symlink entries beneath these roots may be followed. */
  readonly internalSymlinkRoots?: readonly string[]
  readonly limits?: Partial<PiResourceDigestLimits>
}

export interface PiResourceSet {
  readonly promptParts?: readonly (string | undefined)[]
  readonly additionalSkillPaths?: readonly string[]
  readonly packages?: readonly PiPackageSource[]
  readonly extensionPaths?: readonly string[]
}

/** Canonical normalization shared by Workspace and CLI resource resolvers. */
export function createPiResourceDigestInput(input: {
  readonly piCwd: string
  readonly piAgentDir?: string
  readonly piUserHome?: string
  readonly noSkills?: boolean
  readonly resourceSets: readonly PiResourceSet[]
  readonly authorizedRoots: readonly string[]
  readonly allowInternalSymlinks?: boolean
  readonly internalSymlinkRoots?: readonly string[]
  readonly limits?: Partial<PiResourceDigestLimits>
}): PiResourceDigestInput {
  const piCwd = resolvePiPath(input.piCwd, process.cwd())
  const piAgentDir = resolvePiPath(input.piAgentDir ?? getAgentDir(), process.cwd())
  const piUserHome = resolvePiPath(input.piUserHome ?? homedir(), process.cwd())
  const noSkills = input.noSkills ?? true
  return {
    piCwd,
    piAgentDir,
    piUserHome,
    noSkills,
    promptParts: input.resourceSets.flatMap((set) => set.promptParts ?? []),
    additionalSkillPaths: uniqueStrings(input.resourceSets.flatMap((set) => set.additionalSkillPaths ?? [])),
    packages: compactPiPackages(input.resourceSets.flatMap((set) => set.packages ?? [])),
    extensionPaths: uniqueStrings(input.resourceSets.flatMap((set) => set.extensionPaths ?? [])),
    allowInternalSymlinks: input.allowInternalSymlinks,
    internalSymlinkRoots: input.internalSymlinkRoots?.map((root) => resolvePiPath(root, piCwd)),
    authorizedRoots: uniqueStrings([
      piCwd,
      piAgentDir,
      ...(noSkills ? [] : [join(piUserHome, '.agents')]),
      ...input.authorizedRoots.map((root) => resolvePiPath(root, piCwd)),
    ]),
    ...(input.limits ? { limits: input.limits } : {}),
  }
}

type StableResourceError = Error & { code: string; statusCode: number; retryable?: boolean }

interface WalkState {
  readonly hash: Hash
  readonly limits: PiResourceDigestLimits
  readonly authorizedRoots: readonly string[]
  readonly allowInternalSymlinks: boolean
  readonly internalSymlinkRoots: readonly string[]
  nodes: number
  bytes: number
}

const FORMAT_VERSION = 'boring-pi-resource-digest-v4'
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules'])
// Host-written observation metadata is not a Pi input. Including it makes the
// act of loading a newly discovered Boring plugin invalidate its own reload.
const EXCLUDED_FILES = new Set(['.boring-signature.json'])

/** Bounded asynchronous content identity for the exact Pi resources considered by a reload candidate. */
export async function digestPiResourceInputs(input: PiResourceDigestInput): Promise<string> {
  const hash = createHash('sha256')
  const piCwd = resolvePiPath(input.piCwd, process.cwd())
  const piAgentDir = resolvePiPath(input.piAgentDir, process.cwd())
  const piUserHome = resolvePiPath(input.piUserHome, process.cwd())
  const projectSettingsDir = join(piCwd, '.pi')
  const authorizedRoots = [...new Set(input.authorizedRoots.map((path) => resolvePiPath(path, piCwd)))]
  if (authorizedRoots.length === 0) {
    throw stableError(ErrorCode.enum.CONFIG_INVALID, 400, 'Pi resource digest requires at least one independently authorized root')
  }
  const limits = normalizeLimits(input.limits)
  const state: WalkState = {
    hash,
    limits,
    authorizedRoots,
    allowInternalSymlinks: input.allowInternalSymlinks ?? false,
    internalSymlinkRoots: (input.internalSymlinkRoots ?? []).map((root) => resolvePiPath(root, piCwd)),
    nodes: 0,
    bytes: 0,
  }
  frameString(hash, 'format', FORMAT_VERSION)
  frameString(hash, 'pi-cwd', piCwd)
  frameString(hash, 'project-settings-dir', projectSettingsDir)
  frameString(hash, 'user-agent-dir', piAgentDir)
  frameString(hash, 'user-home', piUserHome)
  const promptText = (input.promptParts ?? [])
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
  frameString(hash, 'prompt', promptText)
  await hashResourceCollection(state, piCwd, 'settings', [
    join(projectSettingsDir, 'settings.json'),
    join(piAgentDir, 'settings.json'),
  ], false)
  await hashResourceCollection(state, piCwd, 'skill', input.additionalSkillPaths ?? [], false)
  const localExtensionPaths = (input.extensionPaths ?? []).filter(isLocalPiResourceSource)
  for (const source of (input.extensionPaths ?? []).filter((value) => !isLocalPiResourceSource(value)).sort()) {
    frameString(hash, 'remote-extension-source', source)
  }
  await hashResourceCollection(state, piCwd, 'extension', localExtensionPaths, true)

  const settingsManager = createResourceSettingsManager(piCwd, piAgentDir, [...(input.packages ?? [])], {
    includePackage: (source) => isLocalPiResourceSource(typeof source === 'string' ? source : source.source),
  })
  const packageManager = new DefaultPackageManager({ cwd: piCwd, agentDir: piAgentDir, settingsManager })
  const resolved = await packageManager.resolve(async () => 'skip')
  const explicitExtensions = localExtensionPaths.length === 0
    ? emptyResolvedPaths()
    : await packageManager.resolveExtensionSources(localExtensionPaths, { temporary: true })
  const settingsCollections = input.noSkills
    ? [resolved.extensions, resolved.prompts, resolved.themes]
    : resolvedCollections(resolved)
  await hashResolvedPiInventory(state, [...settingsCollections, ...resolvedCollections(explicitExtensions)])

  for (const source of [...(input.packages ?? [])].sort((left, right) =>
    packageDescriptor(left).localeCompare(packageDescriptor(right)))) {
    frameString(hash, 'package-descriptor', packageDescriptor(source))
    const sourceValue = typeof source === 'string' ? source : source.source
    const localPath = localPiPackagePath(sourceValue, projectSettingsDir)
    if (localPath) await hashLocalResource(state, localPath, '.', 0)
  }
  return `sha256:${hash.digest('hex')}`
}

/** Immutable digest plus the reload fences that defend that exact snapshot. */
export async function createPiResourceDigestFence(
  resolveInput: () => PiResourceDigestInput | Promise<PiResourceDigestInput>,
): Promise<{
  readonly resourceInputDigest: string
  readonly revalidateResourceInputs: () => Promise<void>
}> {
  const resourceInputDigest = await digestPiResourceInputs(await resolveInput())
  return {
    resourceInputDigest,
    async revalidateResourceInputs() {
      const currentResourceInputDigest = await digestPiResourceInputs(await resolveInput())
      if (currentResourceInputDigest !== resourceInputDigest) {
        throw new AgentGatewayError(
          AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
          'Pi resource inputs changed after reload admission',
          { expectedResourceInputDigest: resourceInputDigest, currentResourceInputDigest },
        )
      }
    },
  }
}

function normalizeLimits(input: Partial<PiResourceDigestLimits> | undefined): PiResourceDigestLimits {
  const limits = { ...DEFAULT_PI_RESOURCE_DIGEST_LIMITS, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw stableError(ErrorCode.enum.CONFIG_INVALID, 400, `Pi resource digest ${name} must be a positive safe integer`)
    }
  }
  return limits
}

function packageDescriptor(source: PiPackageSource): string {
  if (typeof source === 'string') return JSON.stringify({ source })
  return JSON.stringify({
    source: source.source,
    autoload: source.autoload,
    extensions: source.extensions ? [...source.extensions].sort() : undefined,
    skills: source.skills ? [...source.skills].sort() : undefined,
    prompts: source.prompts ? [...source.prompts].sort() : undefined,
    themes: source.themes ? [...source.themes].sort() : undefined,
  })
}

async function hashResourceCollection(
  state: WalkState,
  baseDir: string,
  kind: string,
  paths: readonly string[],
  digestContainingArtifact: boolean,
): Promise<void> {
  for (const path of [...new Set(paths)].sort()) {
    const absolutePath = resolvePiPath(path, baseDir)
    await assertContainedWithoutSymlinks(absolutePath, state.authorizedRoots, state.allowInternalSymlinks, state.internalSymlinkRoots)
    try {
      await lstat(absolutePath)
    } catch (error) {
      if (isMissing(error)) {
        frameString(state.hash, `${kind}-missing`, absolutePath)
        continue
      }
      throw error
    }
    frameString(state.hash, `${kind}-entry`, absolutePath)
    const artifactRoot = digestContainingArtifact
      ? await findContainingArtifactRoot(absolutePath, state.authorizedRoots)
      : absolutePath
    frameString(state.hash, `${kind}-artifact-root`, relative(artifactRoot, absolutePath))
    await hashLocalResource(state, artifactRoot, '.', 0)
  }
}

function localPiPackagePath(source: string, baseDir: string): string | undefined {
  return isLocalPiResourceSource(source) ? resolvePiPath(source, baseDir) : undefined
}

function isLocalPiResourceSource(source: string): boolean {
  const value = source.trim()
  return !['npm:', 'git:', 'github:', 'http:', 'https:', 'ssh:'].some((prefix) => value.startsWith(prefix))
}

function emptyResolvedPaths(): ResolvedPaths {
  return { extensions: [], skills: [], prompts: [], themes: [] }
}

function resolvedCollections(paths: ResolvedPaths) {
  return [paths.extensions, paths.skills, paths.prompts, paths.themes]
}

async function hashResolvedPiInventory(
  state: WalkState,
  collections: ReturnType<typeof resolvedCollections>,
): Promise<void> {
  const resources = new Set<string>()
  const packageManifests = new Set<string>()
  const inventory = collections.flat().map((resource) => ({
    resource,
    descriptor: JSON.stringify({
      path: resource.path,
      enabled: resource.enabled,
      source: resource.metadata.source,
      scope: resource.metadata.scope,
      origin: resource.metadata.origin,
    }),
  })).sort((left, right) => left.descriptor.localeCompare(right.descriptor))
  for (const { resource, descriptor } of inventory) {
    frameString(state.hash, 'resolved-resource', descriptor)
    if (resource.metadata.origin === 'package' && resource.metadata.baseDir) {
      packageManifests.add(join(resource.metadata.baseDir, 'package.json'))
    }
    resources.add(resource.path)
  }
  await hashResourceCollection(state, state.authorizedRoots[0]!, 'resolved-package-manifest', [...packageManifests], false)
  await hashResourceCollection(state, state.authorizedRoots[0]!, 'resolved-resource', [...resources], false)
}

/** Mirrors Pi's cwd-relative path normalization for configured resources. */
function resolvePiPath(input: string, baseDir: string): string {
  let normalized = input.trim()
  if (normalized === '~') normalized = homedir()
  else if (normalized.startsWith('~/') || (process.platform === 'win32' && normalized.startsWith('~\\'))) {
    normalized = resolve(homedir(), normalized.slice(2))
  } else if (/^file:\/\//.test(normalized)) {
    normalized = fileURLToPath(normalized)
  }
  return isAbsolute(normalized) ? resolve(normalized) : resolve(baseDir, normalized)
}

async function findContainingArtifactRoot(path: string, authorizedRoots: readonly string[]): Promise<string> {
  let current = dirname(path)
  const boundary = mostSpecificContainingRoot(current, authorizedRoots)
  if (!boundary) throw stableError(ErrorCode.enum.PATH_ESCAPE, 403, `Pi resource path is outside authorized roots: ${path}`)
  while (isContained(current, boundary)) {
    try {
      const packageStat = await lstat(resolve(current, 'package.json'))
      if (packageStat.isSymbolicLink()) {
        throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource package manifest cannot be a symlink: ${current}`)
      }
      if (packageStat.isFile()) return current
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (current === boundary) break
    current = dirname(current)
  }
  return dirname(path)
}

async function hashLocalResource(
  state: WalkState,
  path: string,
  logicalPath: string,
  depth: number,
): Promise<void> {
  const absolutePath = resolve(path)
  await assertContainedWithoutSymlinks(absolutePath, state.authorizedRoots, state.allowInternalSymlinks, state.internalSymlinkRoots)
  if (depth > state.limits.maxDepth) {
    throw limitError(`Pi resource tree exceeds maximum depth ${state.limits.maxDepth}`)
  }
  let stat
  try {
    stat = await lstat(absolutePath)
  } catch (error) {
    if (isMissing(error)) {
      frameString(state.hash, 'missing', logicalPath)
      return
    }
    throw error
  }
  state.nodes += 1
  if (state.nodes > state.limits.maxFiles) {
    throw limitError(`Pi resource tree exceeds maximum node count ${state.limits.maxFiles}`)
  }
  if (stat.isSymbolicLink()) {
    if (!state.allowInternalSymlinks || (state.internalSymlinkRoots.length > 0 && !state.internalSymlinkRoots.some((root) => isContained(absolutePath, root)))) {
      throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource symlinks are not allowed: ${absolutePath}`)
    }
    const target = await realpath(absolutePath)
    if (!mostSpecificContainingRoot(target, state.authorizedRoots)) {
      throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource symlink resolves outside authorized roots: ${absolutePath}`)
    }
    frameString(state.hash, 'symlink-target', target)
    await hashLocalResource(state, target, logicalPath, depth)
    return
  }
  if (stat.isDirectory()) {
    frameString(state.hash, 'directory', logicalPath)
    const openedTarget = await realpath(absolutePath)
    if (!mostSpecificContainingRoot(openedTarget, state.authorizedRoots)) {
      throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource resolves outside authorized roots: ${absolutePath}`)
    }
    assertSameFile(stat, await statPath(openedTarget), absolutePath)
    const entries: import('node:fs').Dirent[] = []
    for await (const entry of await opendir(openedTarget)) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue
      if (entry.isFile() && EXCLUDED_FILES.has(entry.name)) continue
      if (entries.length >= state.limits.maxFiles - state.nodes) {
        throw limitError(`Pi resource tree exceeds maximum node count ${state.limits.maxFiles}`)
      }
      entries.push(entry)
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      frameString(state.hash, 'entry-name', entry.name)
      await hashLocalResource(
        state,
        resolve(openedTarget, entry.name),
        logicalPath === '.' ? entry.name : `${logicalPath}/${entry.name}`,
        depth + 1,
      )
    }
    const afterTarget = await realpath(absolutePath)
    if (afterTarget !== openedTarget) throw changedError(absolutePath)
    assertSameFile(stat, await statPath(afterTarget), absolutePath)
    return
  }
  if (!stat.isFile()) {
    throw stableError(ErrorCode.enum.CONFIG_INVALID, 400, `Unsupported Pi resource node: ${absolutePath}`)
  }
  if (stat.size > state.limits.maxFileBytes) {
    throw limitError(`Pi resource file exceeds maximum bytes ${state.limits.maxFileBytes}: ${logicalPath}`)
  }
  if (state.bytes + stat.size > state.limits.maxTotalBytes) {
    throw limitError(`Pi resource tree exceeds maximum total bytes ${state.limits.maxTotalBytes}`)
  }
  frameString(state.hash, 'file', logicalPath)
  frameNumber(state.hash, 'file-bytes', stat.size)
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    assertSameFile(stat, opened, absolutePath)
    const openedTarget = await realpath(absolutePath)
    if (!mostSpecificContainingRoot(openedTarget, state.authorizedRoots)) {
      throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource resolves outside authorized roots: ${absolutePath}`)
    }
    assertSameFile(opened, await statPath(openedTarget), absolutePath)
    const buffer = new Uint8Array(Math.min(64 * 1024, Math.max(1, stat.size)))
    let offset = 0
    while (offset < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.byteLength, stat.size - offset), offset)
      if (bytesRead === 0) throw changedError(absolutePath)
      state.hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    const after = await handle.stat()
    assertSameFile(opened, after, absolutePath)
    const afterTarget = await realpath(absolutePath)
    if (afterTarget !== openedTarget) throw changedError(absolutePath)
    assertSameFile(after, await statPath(afterTarget), absolutePath)
    state.bytes += offset
  } finally {
    await handle.close()
  }
}

function assertSameFile(
  before: { dev: number | bigint; ino: number | bigint; size: number; mtimeMs: number; ctimeMs: number },
  after: { dev: number | bigint; ino: number | bigint; size: number; mtimeMs: number; ctimeMs: number },
  path: string,
): void {
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
  ) throw changedError(path)
}

async function assertContainedWithoutSymlinks(
  path: string,
  roots: readonly string[],
  allowInternalSymlinks = false,
  internalSymlinkRoots: readonly string[] = [],
): Promise<void> {
  const root = mostSpecificContainingRoot(path, roots)
  if (!root) {
    throw stableError(ErrorCode.enum.PATH_ESCAPE, 403, `Pi resource path is outside authorized roots: ${path}`)
  }
  const absolutePath = resolve(path)
  const pathRoot = parse(absolutePath).root
  const segments = relative(pathRoot, absolutePath).split(sep).filter(Boolean)
  let current = pathRoot
  for (const segment of segments) {
    current = resolve(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        if (!allowInternalSymlinks || (internalSymlinkRoots.length > 0 && !internalSymlinkRoots.some((root) => isContained(current, root)))) {
          throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource symlinks are not allowed: ${current}`)
        }
        const target = await realpath(current)
        if (!mostSpecificContainingRoot(target, roots)) {
          throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, `Pi resource symlink resolves outside authorized roots: ${current}`)
        }
      }
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

function mostSpecificContainingRoot(path: string, roots: readonly string[]): string | undefined {
  return roots.filter((root) => isContained(path, root)).sort((left, right) => right.length - left.length)[0]
}

function isContained(path: string, root: string): boolean {
  const value = relative(resolve(root), resolve(path))
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}

function frameString(hash: Hash, tag: string, value: string): void {
  frameBytes(hash, new TextEncoder().encode(tag))
  frameBytes(hash, new TextEncoder().encode(value))
}

function frameNumber(hash: Hash, tag: string, value: number): void {
  frameString(hash, tag, String(value))
}

function frameBytes(hash: Hash, bytes: Uint8Array): void {
  const length = new Uint8Array(8)
  new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength), false)
  hash.update(length)
  hash.update(bytes)
}

function limitError(message: string): StableResourceError {
  return stableError(ErrorCode.enum.MCP_AGENT_ARTIFACT_TOO_LARGE, 413, message)
}

function changedError(path: string): StableResourceError {
  return stableError(ErrorCode.enum.AGENT_RUNTIME_NOT_READY, 409, `Pi resource changed while it was being read: ${path}`, true)
}

function stableError(code: string, statusCode: number, message: string, retryable?: boolean): StableResourceError {
  return Object.assign(new Error(message), { code, statusCode, ...(retryable === undefined ? {} : { retryable }) })
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'ENOENT'
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}
