import { createHash, type Hash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, readFile, realpath, stat as statPath, type FileHandle } from 'node:fs/promises'
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
  readonly authorizedRoots: AuthorizedRoots
  readonly allowInternalSymlinks: boolean
  nodes: number
  bytes: number
}

interface AuthorizedRoot {
  /** Independently authorized host-owned name. Resource paths never become roots. */
  readonly lexical: string
  /** Canonical name captured while the root descriptor was opened. */
  readonly canonical: string
  /** Pins the trusted directory inode for descriptor-relative traversal. */
  readonly handle: FileHandle
}

interface AuthorizedRoots {
  readonly entries: readonly AuthorizedRoot[]
  readonly lexical: readonly string[]
  readonly canonical: readonly string[]
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
  const lexicalAuthorizedRoots = [...new Set(input.authorizedRoots.map((path) => resolvePiPath(path, piCwd)))]
  if (lexicalAuthorizedRoots.length === 0) {
    throw stableError(ErrorCode.enum.CONFIG_INVALID, 400, 'Pi resource digest requires at least one independently authorized root')
  }
  const authorizedRoots = await resolveAuthorizedRoots(lexicalAuthorizedRoots)
  try {
  const limits = normalizeLimits(input.limits)
  const state: WalkState = {
    hash,
    limits,
    authorizedRoots,
    allowInternalSymlinks: input.allowInternalSymlinks ?? false,
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

  // DefaultPackageManager reads package manifests while resolving. Authorize
  // every local package source first, including sources declared in settings.
  const localPackagePaths = await configuredLocalPackagePaths({
    projectSettingsPath: join(projectSettingsDir, 'settings.json'),
    globalSettingsPath: join(piAgentDir, 'settings.json'),
    projectSettingsDir,
    piAgentDir,
    packages: input.packages ?? [],
  })
  await assertPiResourcePathsAuthorized({
    paths: localPackagePaths,
    authorizedRoots: lexicalAuthorizedRoots,
    allowInternalSymlinks: input.allowInternalSymlinks ?? false,
  })

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
  } finally {
    await Promise.all(authorizedRoots.entries.map((root) => root.handle.close()))
  }
}

/** Validate local resource names before any manifest scan or module import. */
export async function assertPiResourcePathsAuthorized(input: {
  readonly paths: readonly string[]
  readonly authorizedRoots: readonly string[]
  readonly allowInternalSymlinks?: boolean
}): Promise<void> {
  if (input.paths.length === 0) return
  const lexicalRoots = uniqueStrings(input.authorizedRoots.map((root) => resolve(root)))
  const roots = await resolveAuthorizedRoots(lexicalRoots)
  try {
    for (const path of uniqueStrings(input.paths.map((entry) => resolve(entry)))) {
      assertLexicallyContained(path, roots.lexical)
      await assertSymlinkPolicy(path, roots, input.allowInternalSymlinks ?? false)
      try {
        const lexicalStat = await lstat(path)
        await resolveContainedTarget(path, roots, lexicalStat.isSymbolicLink())
      } catch (error) {
        if (!isMissing(error)) throw error
        await assertMissingPathContained(path, roots)
      }
    }
    await Promise.all(roots.entries.map(revalidateAuthorizedRoot))
  } finally {
    await Promise.all(roots.entries.map((root) => root.handle.close()))
  }
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
    assertLexicallyContained(absolutePath, state.authorizedRoots.lexical)
    await assertSymlinkPolicy(absolutePath, state.authorizedRoots, state.allowInternalSymlinks)
    try {
      await lstat(absolutePath)
    } catch (error) {
      if (isMissing(error)) {
        await assertMissingPathContained(absolutePath, state.authorizedRoots)
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

async function configuredLocalPackagePaths(input: {
  projectSettingsPath: string
  globalSettingsPath: string
  projectSettingsDir: string
  piAgentDir: string
  packages: readonly PiPackageSource[]
}): Promise<string[]> {
  const paths: string[] = []
  const append = (source: PiPackageSource, baseDir: string) => {
    const value = typeof source === 'string' ? source : source.source
    const path = localPiPackagePath(value, baseDir)
    if (path) paths.push(path)
  }
  for (const source of input.packages) append(source, input.projectSettingsDir)
  for (const [settingsPath, baseDir] of [
    [input.globalSettingsPath, input.piAgentDir],
    [input.projectSettingsPath, input.projectSettingsDir],
  ] as const) {
    try {
      const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as { packages?: unknown }
      if (!Array.isArray(parsed.packages)) continue
      for (const source of parsed.packages) {
        if (typeof source === 'string') append(source, baseDir)
        else if (source && typeof source === 'object' && typeof (source as { source?: unknown }).source === 'string') {
          append(source as PiPackageSource, baseDir)
        }
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  return uniqueStrings(paths)
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
  await hashResourceCollection(state, state.authorizedRoots.lexical[0]!, 'resolved-package-manifest', [...packageManifests], false)
  await hashResourceCollection(state, state.authorizedRoots.lexical[0]!, 'resolved-resource', [...resources], false)
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

async function findContainingArtifactRoot(path: string, authorizedRoots: AuthorizedRoots): Promise<string> {
  let current = dirname(path)
  const boundary = mostSpecificContainingRoot(current, authorizedRoots.lexical)
  if (!boundary) throw stableError(ErrorCode.enum.PATH_ESCAPE, 403, `Pi resource path is outside authorized roots: ${path}`)
  while (isContained(current, boundary)) {
    const packagePath = resolve(current, 'package.json')
    try {
      const packageStat = await statPath(packagePath)
      if (packageStat.isFile()) {
        await resolveContainedTarget(packagePath, authorizedRoots)
        return current
      }
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
  assertLexicallyContained(absolutePath, state.authorizedRoots.lexical)
  await assertSymlinkPolicy(absolutePath, state.authorizedRoots, state.allowInternalSymlinks)
  if (depth > state.limits.maxDepth) {
    throw limitError(`Pi resource tree exceeds maximum depth ${state.limits.maxDepth}`)
  }
  if (state.allowInternalSymlinks) {
    let lexicalStat
    try {
      lexicalStat = await lstat(absolutePath)
    } catch (error) {
      if (isMissing(error)) {
        await assertMissingPathContained(absolutePath, state.authorizedRoots)
        frameString(state.hash, 'missing', logicalPath)
        return
      }
      throw error
    }
    if (process.platform !== 'linux') {
      if (lexicalStat.isSymbolicLink() || await pathContainsSymlink(absolutePath)) {
        throw stableError(
          ErrorCode.enum.CONFIG_INVALID,
          400,
          `Contained Pi resource symlinks require descriptor-relative traversal, which is unavailable on ${process.platform}. Replace the symlink with a direct path or run this CLI on Linux.`,
        )
      }
      // Normal direct resources retain the portable pre/post identity fences.
    } else {
      const target = await resolveContainedTarget(absolutePath, state.authorizedRoots, lexicalStat.isSymbolicLink())
      const root = mostSpecificCanonicalRoot(target, state.authorizedRoots)
      if (!root) throw symlinkEscapeError(absolutePath, target, state.authorizedRoots)
      await hashAnchoredResource(state, root, target, absolutePath, logicalPath, depth)
      return
    }
    // Fall through to the portable direct-resource reader below.
  }
  let lexicalStat
  try {
    lexicalStat = await lstat(absolutePath)
  } catch (error) {
    if (isMissing(error)) {
      await assertMissingPathContained(absolutePath, state.authorizedRoots)
      frameString(state.hash, 'missing', logicalPath)
      return
    }
    throw error
  }
  state.nodes += 1
  if (state.nodes > state.limits.maxFiles) {
    throw limitError(`Pi resource tree exceeds maximum node count ${state.limits.maxFiles}`)
  }
  const openedTarget = await resolveContainedTarget(absolutePath, state.authorizedRoots, lexicalStat.isSymbolicLink())
  const stat = await statPath(openedTarget)
  if (stat.isDirectory()) {
    frameString(state.hash, 'directory', logicalPath)
    const entries: import('node:fs').Dirent[] = []
    const descriptorPath = process.platform === 'linux'
      ? '/proc/self/fd'
      : process.platform === 'darwin'
        ? '/dev/fd'
        : undefined
    const directoryHandle = descriptorPath
      ? await open(openedTarget, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      : undefined
    try {
      if (directoryHandle) assertSameFile(stat, await directoryHandle.stat(), absolutePath)
      // Linux and macOS expose an already-open descriptor as a path, binding
      // entry discovery to the verified directory inode instead of re-opening
      // a raceable pathname. Node has no portable descriptor-based opendir API;
      // other platforms retain the pre/post realpath and identity fences below.
      const directoryPath = directoryHandle ? `${descriptorPath}/${directoryHandle.fd}` : openedTarget
      for await (const entry of await opendir(directoryPath)) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue
        if (entry.isFile() && EXCLUDED_FILES.has(entry.name)) continue
        if (entries.length >= state.limits.maxFiles - state.nodes) {
          throw limitError(`Pi resource tree exceeds maximum node count ${state.limits.maxFiles}`)
        }
        entries.push(entry)
      }
      assertSameFile(stat, directoryHandle ? await directoryHandle.stat() : await statPath(openedTarget), absolutePath)
    } finally {
      await directoryHandle?.close()
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      frameString(state.hash, 'entry-name', entry.name)
      await hashLocalResource(
        state,
        resolve(absolutePath, entry.name),
        logicalPath === '.' ? entry.name : `${logicalPath}/${entry.name}`,
        depth + 1,
      )
    }
    const afterTarget = await realpath(absolutePath)
    if (afterTarget !== openedTarget) throw changedError(absolutePath)
    assertCanonicalTargetContained(afterTarget, state.authorizedRoots, absolutePath)
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
  // A link is only an alternate name for independently authorized content: the
  // digest frames the logical Pi inventory and resolved bytes, never link metadata
  // or target spelling. Link topology alone therefore cannot change the digest.
  // Opening the canonical target with O_NOFOLLOW, then re-resolving the original
  // name and comparing file identity before and after the read, keeps that
  // topology-independence from weakening containment or the TOCTOU fence.
  const handle = await open(openedTarget, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    assertSameFile(stat, opened, absolutePath)
    const afterOpenTarget = await realpath(absolutePath)
    if (afterOpenTarget !== openedTarget) throw changedError(absolutePath)
    assertCanonicalTargetContained(afterOpenTarget, state.authorizedRoots, absolutePath)
    assertSameFile(opened, await statPath(afterOpenTarget), absolutePath)
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
    assertCanonicalTargetContained(afterTarget, state.authorizedRoots, absolutePath)
    assertSameFile(after, await statPath(afterTarget), absolutePath)
    state.bytes += offset
  } finally {
    await handle.close()
  }
}

async function hashAnchoredResource(
  state: WalkState,
  root: AuthorizedRoot,
  canonicalTarget: string,
  requestedPath: string,
  logicalPath: string,
  depth: number,
): Promise<void> {
  const handle = await openAnchored(root, canonicalTarget, requestedPath)
  try {
    await hashOpenResource(state, handle, requestedPath, logicalPath, depth)
    if (await realpath(requestedPath) !== canonicalTarget) throw changedError(requestedPath)
    await revalidateAuthorizedRoot(root)
  } finally {
    await handle.close()
  }
}

async function openAnchored(root: AuthorizedRoot, canonicalTarget: string, requestedPath: string): Promise<FileHandle> {
  const suffix = relative(root.canonical, canonicalTarget)
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) {
    throw symlinkEscapeError(requestedPath, canonicalTarget, { entries: [root], lexical: [root.lexical], canonical: [root.canonical] })
  }
  // /proc/self/fd/<n> is itself a kernel-owned link to the already-open root;
  // following that one link duplicates the trusted descriptor. Every resource
  // component opened below remains O_NOFOLLOW.
  let handle = await open(`/proc/self/fd/${root.handle.fd}`, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    const segments = suffix.split(sep).filter(Boolean)
    for (let index = 0; index < segments.length; index += 1) {
      const next = await open(
        `/proc/self/fd/${handle.fd}/${segments[index]}`,
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      )
      await handle.close()
      handle = next
      if (index < segments.length - 1 && !(await handle.stat()).isDirectory()) {
        throw changedError(canonicalTarget)
      }
    }
    return handle
  } catch (error) {
    await handle.close()
    if (isSymlinkTraversalError(error)) {
      throw changedError(requestedPath)
    }
    throw error
  }
}

async function hashOpenResource(
  state: WalkState,
  handle: FileHandle,
  requestedPath: string,
  logicalPath: string,
  depth: number,
): Promise<void> {
  if (depth > state.limits.maxDepth) {
    throw limitError(`Pi resource tree exceeds maximum depth ${state.limits.maxDepth}`)
  }
  const before = await handle.stat()
  state.nodes += 1
  if (state.nodes > state.limits.maxFiles) {
    throw limitError(`Pi resource tree exceeds maximum node count ${state.limits.maxFiles}`)
  }
  if (before.isDirectory()) {
    frameString(state.hash, 'directory', logicalPath)
    const descriptorPath = `/proc/self/fd/${handle.fd}`
    const entries = await readDirectoryEntries(descriptorPath, state)
    for (const entry of entries) {
      frameString(state.hash, 'entry-name', entry.name)
      let child: FileHandle
      try {
        child = await open(
          `${descriptorPath}/${entry.name}`,
          constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
        )
      } catch (error) {
        if (isSymlinkTraversalError(error)) {
          const childPath = resolve(requestedPath, entry.name)
          const target = await resolveContainedTarget(childPath, state.authorizedRoots, true)
          const root = mostSpecificCanonicalRoot(target, state.authorizedRoots)
          if (!root) throw symlinkEscapeError(childPath, target, state.authorizedRoots)
          child = await openAnchored(root, target, childPath)
        } else {
          throw error
        }
      }
      try {
        const childBefore = await child.stat()
        await hashOpenResource(
          state,
          child,
          `${requestedPath}/${entry.name}`,
          logicalPath === '.' ? entry.name : `${logicalPath}/${entry.name}`,
          depth + 1,
        )
        assertSameFile(childBefore, await statPath(`${descriptorPath}/${entry.name}`), `${requestedPath}/${entry.name}`)
      } finally {
        await child.close()
      }
    }
    const afterEntries = await readDirectoryEntries(descriptorPath, state, false)
    if (entries.map((entry) => entry.name).join('\0') !== afterEntries.map((entry) => entry.name).join('\0')) {
      throw changedError(requestedPath)
    }
    assertSameFile(before, await handle.stat(), requestedPath)
    return
  }
  if (!before.isFile()) {
    throw stableError(ErrorCode.enum.CONFIG_INVALID, 400, `Unsupported Pi resource node: ${requestedPath}`)
  }
  if (before.size > state.limits.maxFileBytes) {
    throw limitError(`Pi resource file exceeds maximum bytes ${state.limits.maxFileBytes}: ${logicalPath}`)
  }
  if (state.bytes + before.size > state.limits.maxTotalBytes) {
    throw limitError(`Pi resource tree exceeds maximum total bytes ${state.limits.maxTotalBytes}`)
  }
  frameString(state.hash, 'file', logicalPath)
  frameNumber(state.hash, 'file-bytes', before.size)
  const buffer = new Uint8Array(Math.min(64 * 1024, Math.max(1, before.size)))
  let offset = 0
  while (offset < before.size) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.byteLength, before.size - offset), offset)
    if (bytesRead === 0) throw changedError(requestedPath)
    state.hash.update(buffer.subarray(0, bytesRead))
    offset += bytesRead
  }
  assertSameFile(before, await handle.stat(), requestedPath)
  state.bytes += offset
}

async function readDirectoryEntries(
  descriptorPath: string,
  state: WalkState,
  enforceBudget = true,
): Promise<import('node:fs').Dirent[]> {
  const entries: import('node:fs').Dirent[] = []
  for await (const entry of await opendir(descriptorPath)) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue
    if (entry.isFile() && EXCLUDED_FILES.has(entry.name)) continue
    if (enforceBudget && entries.length >= state.limits.maxFiles - state.nodes) {
      throw limitError(`Pi resource tree exceeds maximum node count ${state.limits.maxFiles}`)
    }
    entries.push(entry)
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

function isSymlinkTraversalError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 'ELOOP' || code === 'ENOTDIR'
}

function mostSpecificCanonicalRoot(path: string, roots: AuthorizedRoots): AuthorizedRoot | undefined {
  return roots.entries
    .filter((root) => isContained(path, root.canonical))
    .sort((left, right) => right.canonical.length - left.canonical.length)[0]
}

function symlinkEscapeError(requestedPath: string, target: string, roots: AuthorizedRoots): StableResourceError {
  const escapedRoot = mostSpecificContainingRoot(requestedPath, roots.lexical) ?? '<unknown authorized root>'
  return stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, symlinkEscapeMessage(requestedPath, target, escapedRoot))
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

async function resolveAuthorizedRoots(lexicalRoots: readonly string[]): Promise<AuthorizedRoots> {
  const entries: AuthorizedRoot[] = []
  try {
    for (const lexical of lexicalRoots) {
      try {
        const root = process.platform === 'linux'
          ? await openLinuxAuthorizedRoot(lexical)
          : await openPortableAuthorizedRoot(lexical)
        if (root) entries.push(root)
      } catch (error) {
        if (isSymlinkTraversalError(error)) throw changedError(lexical)
        if (!isMissing(error)) throw error
      }
    }
    return {
      entries,
      // Missing host-owned roots remain lexical boundaries for missing
      // resources. They never add canonical authority until they exist.
      lexical: lexicalRoots,
      canonical: entries.map((root) => root.canonical),
    }
  } catch (error) {
    await Promise.all(entries.map((root) => root.handle.close()))
    throw error
  }
}

/** Establish authority by walking from an already-open filesystem root. */
async function openLinuxAuthorizedRoot(lexical: string): Promise<AuthorizedRoot | undefined> {
  const absolute = resolve(lexical)
  if (await pathContainsSymlink(absolute)) return undefined
  const lexicalBefore = await lstat(absolute)
  if (lexicalBefore.isSymbolicLink() || !lexicalBefore.isDirectory()) return undefined
  const filesystemRoot = parse(absolute).root
  let handle = await open(filesystemRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    for (const segment of relative(filesystemRoot, absolute).split(sep).filter(Boolean)) {
      let next: FileHandle
      try {
        next = await open(
          `/proc/self/fd/${handle.fd}/${segment}`,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
      } catch (error) {
        // The root was direct at admission but became a link while its
        // descriptor chain was established.
        if (isSymlinkTraversalError(error)) throw changedError(absolute)
        throw error
      }
      await handle.close()
      handle = next
    }
    const pinned = await handle.stat()
    assertSameFile(lexicalBefore, pinned, absolute)
    const canonical = await realpath(`/proc/self/fd/${handle.fd}`)
    if (await realpath(absolute) !== canonical) throw changedError(absolute)
    assertSameFile(pinned, await statPath(absolute), absolute)
    return { lexical: absolute, canonical, handle }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Portable direct-root path. Symlinked roots are never admitted as authority. */
async function openPortableAuthorizedRoot(lexical: string): Promise<AuthorizedRoot | undefined> {
  if (await pathContainsSymlink(lexical)) return undefined
  const before = await lstat(lexical)
  if (!before.isDirectory()) return undefined
  const canonical = await realpath(lexical)
  const handle = await open(lexical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    assertSameFile(before, await handle.stat(), lexical)
    if (await realpath(lexical) !== canonical) throw changedError(lexical)
    assertSameFile(before, await statPath(lexical), lexical)
    return { lexical, canonical, handle }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function pathContainsSymlink(path: string): Promise<boolean> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
    current = resolve(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }
  return false
}

async function revalidateAuthorizedRoot(root: AuthorizedRoot): Promise<void> {
  if (await realpath(root.lexical) !== root.canonical) throw changedError(root.lexical)
  assertSameFile(await root.handle.stat(), await statPath(root.lexical), root.lexical)
}

async function assertSymlinkPolicy(path: string, roots: AuthorizedRoots, allowInternalSymlinks: boolean): Promise<void> {
  if (allowInternalSymlinks) return
  const absolutePath = resolve(path)
  const pathRoot = parse(absolutePath).root
  const segments = relative(pathRoot, absolutePath).split(sep).filter(Boolean)
  let current = pathRoot
  for (const segment of segments) {
    current = resolve(current, segment)
    try {
      if (!(await lstat(current)).isSymbolicLink()) continue
      const authorizedRoot = mostSpecificContainingRoot(path, roots.lexical) ?? '<unknown authorized root>'
      throw stableError(
        ErrorCode.enum.PATH_SYMLINK_ESCAPE,
        403,
        `Pi resource path ${path} traverses symlink ${current} under authorized root ${authorizedRoot}, but contained symlinks are disabled for this caller. Set allowInternalSymlinks: true only when the authorized root and linked target are trusted, or replace the symlink with a direct path.`,
      )
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

function assertLexicallyContained(path: string, roots: readonly string[]): void {
  const root = mostSpecificContainingRoot(path, roots)
  if (!root) {
    throw stableError(ErrorCode.enum.PATH_ESCAPE, 403, `Pi resource path is outside authorized roots: ${path}`)
  }
}

async function assertMissingPathContained(path: string, roots: AuthorizedRoots): Promise<void> {
  const boundary = mostSpecificContainingRoot(path, roots.lexical)
  if (!boundary) {
    throw stableError(ErrorCode.enum.PATH_ESCAPE, 403, `Pi resource path is outside authorized roots: ${path}`)
  }
  let current = dirname(path)
  while (isContained(current, boundary)) {
    try {
      const target = await realpath(current)
      assertCanonicalTargetContained(target, roots, path)
      return
    } catch (error) {
      if (!isMissing(error)) throw error
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw stableError(
            ErrorCode.enum.PATH_SYMLINK_ESCAPE,
            403,
            danglingSymlinkMessage(current, boundary),
          )
        }
      } catch (lstatError) {
        if (!isMissing(lstatError)) throw lstatError
      }
    }
    if (current === boundary) return
    current = dirname(current)
  }
}

async function resolveContainedTarget(
  path: string,
  roots: AuthorizedRoots,
  knownSymlink = false,
): Promise<string> {
  try {
    const target = await realpath(path)
    assertCanonicalTargetContained(target, roots, path)
    return target
  } catch (error) {
    if (knownSymlink && isMissing(error)) {
      const boundary = mostSpecificContainingRoot(path, roots.lexical) ?? '<unknown authorized root>'
      throw stableError(ErrorCode.enum.PATH_SYMLINK_ESCAPE, 403, danglingSymlinkMessage(path, boundary))
    }
    throw error
  }
}

function assertCanonicalTargetContained(target: string, roots: AuthorizedRoots, requestedPath: string): void {
  if (!mostSpecificContainingRoot(target, roots.canonical)) {
    const escapedRoot = mostSpecificContainingRoot(requestedPath, roots.lexical) ?? '<unknown authorized root>'
    throw stableError(
      ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      403,
      symlinkEscapeMessage(requestedPath, target, escapedRoot),
    )
  }
}

function symlinkEscapeOperatorAction(): string {
  return 'Move the target under an authorized root, add its trusted containing directory to piResourceAuthorizedRoots, or replace the symlink.'
}

function danglingSymlinkOperatorAction(): string {
  return 'Restore the symlink target, remove the dangling link, or update the configured Pi resource path.'
}

function symlinkEscapeMessage(path: string, target: string, authorizedRoot: string): string {
  return `Pi resource path ${path} resolves to ${target}, which escapes authorized root ${authorizedRoot}. ${symlinkEscapeOperatorAction()}`
}

function danglingSymlinkMessage(path: string, authorizedRoot: string): string {
  return `Pi resource symlink ${path} has no resolvable target under authorized root ${authorizedRoot}. ${danglingSymlinkOperatorAction()}`
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
