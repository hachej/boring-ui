import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'

import {
  AGENT_RESOURCES_FILESYSTEM_ID,
  ErrorCode,
  type AgentSkillResource,
} from '@hachej/boring-agent/shared'
import { parseSkillMetadataFrontmatter } from '@hachej/boring-agent/server'

import type { WorkspacePackageResourceRecord } from './bootstrapServer'

export const PACKAGE_RESOURCE_INVALID_CODE = ErrorCode.enum.PACKAGE_RESOURCE_INVALID
export const PACKAGE_RESOURCE_CONFLICT_CODE = ErrorCode.enum.PACKAGE_RESOURCE_CONFLICT

export class WorkspacePackageResourceRegistryError extends Error {
  readonly code: typeof PACKAGE_RESOURCE_INVALID_CODE | typeof PACKAGE_RESOURCE_CONFLICT_CODE
  readonly packageName: string

  constructor(
    code: typeof PACKAGE_RESOURCE_INVALID_CODE | typeof PACKAGE_RESOURCE_CONFLICT_CODE,
    packageName: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspacePackageResourceRegistryError'
    this.code = code
    this.packageName = packageName
  }
}

interface PackageManifest {
  name?: unknown
  pi?: { skills?: unknown; systemPrompt?: unknown }
}

function parseManifest(packageName: string, bytes: string): PackageManifest {
  try {
    return JSON.parse(bytes) as PackageManifest
  } catch {
    throw invalid(packageName, 'package manifest is not valid JSON')
  }
}

export interface ResolvedAgentPackageSkill {
  readonly packageName: string
  readonly pluginIds: readonly string[]
  /** Canonical server-only file path. Never serialize this value. */
  readonly skillFile: string
  /** Canonical server-only root admitted by the readonly binding. */
  readonly mountRoot: string
  readonly resource: AgentSkillResource
  readonly name?: string
  readonly description?: string
}

export interface ResolvedAgentManagedSkill {
  readonly name: string
  readonly description: string
  readonly resource: AgentSkillResource
  readonly invocable: false
  readonly source: string
}

export interface AgentResourceReadonlyMount {
  readonly logicalRoot: string
  readonly sourceRoot: string
}

export interface ResolvedWorkspacePackageResourceRegistry {
  readonly generation: string
  readonly additionalSkillPaths: readonly string[]
  readonly skills: readonly ResolvedAgentPackageSkill[]
  readonly managedSkills: readonly ResolvedAgentManagedSkill[]
  /** Canonical server-only package roots handled by this snapshot. */
  readonly handledPackageRoots: readonly string[]
  readonly readonlyMounts: readonly AgentResourceReadonlyMount[]
  readonly systemPrompts: readonly { readonly pluginIds: readonly string[]; readonly content: string }[]
  locateSkill(filePath: string): AgentSkillResource | undefined
}

export interface ResolvedAgentPackageResourceView {
  readonly generation: string
  readonly skills: readonly ResolvedAgentPackageSkill[]
  readonly managedSkills: readonly ResolvedAgentManagedSkill[]
  readonly additionalSkillPaths: readonly string[]
  readonly readonlyMounts: readonly AgentResourceReadonlyMount[]
  readonly systemPrompts: readonly string[]
  locateSkill(filePath: string): AgentSkillResource | undefined
}

/**
 * Selects one internally-consistent Agent view from an immutable registry.
 * Shared host skills are global; package skills and prompts follow plugin grants.
 */
export function selectAgentPackageResourceView(
  registry: ResolvedWorkspacePackageResourceRegistry,
  policy: { readonly pluginIds: ReadonlySet<string>; readonly includeAll: boolean },
): ResolvedAgentPackageResourceView {
  const selectedSkills = registry.skills.filter((skill) =>
    skill.packageName === 'shared/pi-agent'
    || policy.includeAll
    || skill.pluginIds.some((pluginId) => policy.pluginIds.has(pluginId)),
  )
  const selectedResourcePaths = new Set(selectedSkills.map((skill) => skill.resource.path))
  return Object.freeze({
    generation: registry.generation,
    skills: selectedSkills,
    managedSkills: selectedSkills.flatMap((skill) => skill.name ? [{
      name: skill.name,
      description: skill.description ?? '',
      resource: skill.resource,
      invocable: false as const,
      source: skill.packageName,
    }] : []),
    additionalSkillPaths: [...new Set(selectedSkills
      .filter((skill) => skill.packageName !== 'shared/pi-agent')
      .map((skill) => skill.mountRoot))],
    readonlyMounts: selectedSkills.map((skill) => ({
      logicalRoot: posix.dirname(skill.resource.path),
      sourceRoot: skill.mountRoot,
    })),
    systemPrompts: registry.systemPrompts
      .filter((prompt) => policy.includeAll || prompt.pluginIds.some((pluginId) => policy.pluginIds.has(pluginId)))
      .map((prompt) => prompt.content),
    locateSkill(filePath: string) {
      const resource = registry.locateSkill(filePath)
      return resource && selectedResourcePaths.has(resource.path) ? resource : undefined
    },
  })
}

function invalid(packageName: string, reason: string): WorkspacePackageResourceRegistryError {
  return new WorkspacePackageResourceRegistryError(
    PACKAGE_RESOURCE_INVALID_CODE,
    packageName,
    `package resource is invalid: ${reason}`,
  )
}

function conflict(packageName: string, reason: string): WorkspacePackageResourceRegistryError {
  return new WorkspacePackageResourceRegistryError(
    PACKAGE_RESOURCE_CONFLICT_CODE,
    packageName,
    `package resource conflicts with another contribution: ${reason}`,
  )
}

function isExpectedPathAdmissionError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}

function admissionRefusal(error: unknown): { code: string; message: string } | undefined {
  const code = resourceAdmissionCode(error)
  if (!code) return undefined
  return {
    code,
    message: error instanceof Error ? error.message : `package resource admission failed (${code})`,
  }
}

function packageRootPath(input: string | URL, packageName: string): string {
  if (input instanceof URL) {
    if (input.protocol !== 'file:') throw invalid(packageName, 'packageRoot URL must use file:')
    return fileURLToPath(input)
  }
  if (!isAbsolute(input)) throw invalid(packageName, 'packageRoot must be absolute')
  return input
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function normalizeDeclaration(packageName: string, declaration: unknown): string {
  if (typeof declaration !== 'string' || declaration.length === 0) {
    throw invalid(packageName, 'pi.skills entries must be non-empty strings')
  }
  if (declaration.includes('\0') || declaration.includes('\\')) {
    throw invalid(packageName, 'pi.skills entry must be a normalized relative path')
  }
  const segments = declaration.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalid(packageName, 'pi.skills entry contains an invalid path segment')
  }
  if (/%(?:2e|2f|5c)/i.test(declaration) || /^[a-z][a-z0-9+.-]*:/i.test(declaration)) {
    throw invalid(packageName, 'pi.skills entry contains an encoded or URL path')
  }
  return declaration
}

/**
 * A skill resolved from the filesystem, before it is attributed to the plugins
 * that contributed its package. Attribution is a cross-entry concern, so it is
 * applied once during assembly rather than repeated per contribution.
 */
type ResolvedSkillDraft = Omit<ResolvedAgentPackageSkill, 'pluginIds'>

async function resolveSkillRecord(input: {
  packageName: string
  sourceSkillFile: string
  logicalFile: string
  packageRoot?: string
}): Promise<ResolvedSkillDraft> {
  let sourceStat: Awaited<ReturnType<typeof stat>>
  try {
    sourceStat = await stat(input.sourceSkillFile)
  } catch (error) {
    if (!isExpectedPathAdmissionError(error)) throw error
    throw invalid(input.packageName, 'declared skill has no SKILL.md file')
  }
  if (!sourceStat.isFile()) throw invalid(input.packageName, 'declared skill has no SKILL.md file')
  const [skillFile, mountRoot] = await Promise.all([
    realpath(input.sourceSkillFile),
    realpath(dirname(input.sourceSkillFile)),
  ])
  if (input.packageRoot) {
    if (!isInside(input.packageRoot, skillFile) || !isInside(input.packageRoot, mountRoot)) {
      throw invalid(input.packageName, 'declared skill resolves outside package root')
    }
    if (mountRoot === input.packageRoot) throw invalid(input.packageName, 'declared skill root must be below the package root')
  }
  if (!isInside(mountRoot, skillFile)) throw invalid(input.packageName, 'SKILL.md resolves outside declared skill root')
  const content = await readFile(skillFile, 'utf8')
  const { name, description } = parseSkillMetadataFrontmatter(content)
  return {
    packageName: input.packageName,
    skillFile,
    mountRoot,
    resource: { filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: input.logicalFile },
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  }
}

async function resolveSkillDeclaration(
  packageName: string,
  canonicalPackageRoot: string,
  declaration: string,
): Promise<ResolvedSkillDraft> {
  const declaredPath = resolve(canonicalPackageRoot, ...declaration.split('/'))
  if (!isInside(canonicalPackageRoot, declaredPath)) throw invalid(packageName, 'pi.skills entry escapes package root')
  let declaredStat: Awaited<ReturnType<typeof stat>>
  try {
    declaredStat = await stat(declaredPath)
  } catch (error) {
    if (!isExpectedPathAdmissionError(error)) throw error
    throw invalid(packageName, 'pi.skills entry does not exist')
  }
  const directFile = declaredStat.isFile() && posix.basename(declaration) === 'SKILL.md'
  if (!declaredStat.isDirectory() && !directFile) {
    throw invalid(packageName, 'pi.skills entry must be a skill directory or SKILL.md file')
  }
  const relativeSkillFile = directFile ? declaration : `${declaration}/SKILL.md`
  return resolveSkillRecord({
    packageName,
    sourceSkillFile: resolve(canonicalPackageRoot, ...relativeSkillFile.split('/')),
    logicalFile: `packages/${packageName}/${relativeSkillFile}`,
    packageRoot: canonicalPackageRoot,
  })
}

function rootsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export interface SharedSkillPath {
  readonly id: string
  readonly skillFile: string
}

/**
 * One entry the resolver declined to admit. Only entries the caller marked
 * skippable can appear here; a required entry still fails the whole resolve.
 */
export interface SkippedWorkspacePackageResource {
  readonly kind: 'package-contribution' | 'shared-skill'
  /** Package name for a contribution, shared skill id for a shared skill. */
  readonly id: string
  /** Admission verdict that caused the skip. */
  readonly code: string
  /** Specific refusal retained for diagnostics; unexpected errors are rethrown. */
  readonly message: string
}

export interface ResolveWorkspacePackageResourcesOptions {
  /** Host-declared shared skills. An inadmissible entry fails the resolve. */
  sharedSkillPaths?: readonly SharedSkillPath[]
  /**
   * Speculatively scanned contributions. An entry that is not independently
   * admissible is reported in `skipped` instead of failing the resolve, and is
   * never mounted or exposed.
   */
  skippableContributions?: readonly WorkspacePackageResourceRecord[]
  /**
   * Ambient shared skills discovered in the user's tree (`~/.pi/agent/skills`
   * is normally a tree of symlinks, so a stale entry is routine). Degrades the
   * same way as `skippableContributions`, but only on an admission verdict —
   * a resolver defect still propagates (gh-1196).
   */
  skippableSharedSkillPaths?: readonly SharedSkillPath[]
}

/** A contribution that passed independent admission: canonical root + manifest. */
interface AdmittedContribution {
  readonly contribution: WorkspacePackageResourceRecord
  readonly canonicalRoot: string
  readonly manifest: PackageManifest
  readonly skippable: boolean
  /** Position in the skippable input, used to report skips in input order. */
  readonly order: number
}

function packageKey(packageName: string, canonicalRoot: string): string {
  return `${packageName}\0${canonicalRoot}`
}

/**
 * Independent admission of one contribution: everything that can be decided
 * from the contribution alone, with no reference to its siblings. Cross-entry
 * conflicts are deliberately *not* checked here — they are decided later, over
 * the survivors only, so that a skipped entry cannot manufacture a conflict.
 */
async function admitContribution(
  contribution: WorkspacePackageResourceRecord,
): Promise<{ canonicalRoot: string; manifest: PackageManifest }> {
  if (contribution.packageName === 'shared/pi-agent') {
    throw invalid(contribution.packageName, 'package name is reserved for host-owned shared skills')
  }
  const requestedRoot = packageRootPath(contribution.packageRoot, contribution.packageName)
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(requestedRoot)
  } catch (error) {
    if (!isExpectedPathAdmissionError(error)) throw error
    throw invalid(contribution.packageName, 'packageRoot is not readable')
  }
  let manifestBytes: string
  try {
    manifestBytes = await readFile(resolve(canonicalRoot, 'package.json'), 'utf8')
  } catch (error) {
    if (!isExpectedPathAdmissionError(error)) throw error
    throw invalid(contribution.packageName, 'package manifest is not readable')
  }
  const manifest = parseManifest(contribution.packageName, manifestBytes)
  if (manifest.name !== contribution.packageName) {
    throw invalid(contribution.packageName, 'package manifest name does not match contribution')
  }
  return { canonicalRoot, manifest }
}

/** Resolve every skill a package declares, exactly once per package root. */
async function resolvePackageSkills(
  packageName: string,
  canonicalRoot: string,
  manifest: PackageManifest,
): Promise<ResolvedSkillDraft[]> {
  if (!Array.isArray(manifest.pi?.skills) || manifest.pi.skills.length === 0) {
    throw invalid(packageName, 'package manifest must declare pi.skills')
  }
  const declarations = [...new Set(manifest.pi.skills.map((entry) => normalizeDeclaration(packageName, entry)))]
  const drafts: ResolvedSkillDraft[] = []
  for (const declaration of declarations.sort()) {
    drafts.push(await resolveSkillDeclaration(packageName, canonicalRoot, declaration))
  }
  assertNoOverlappingLogicalRoots(drafts)
  return drafts
}

/** Resolve one shared skill. Never called more than once per entry. */
async function resolveSharedSkill(shared: SharedSkillPath): Promise<ResolvedSkillDraft & { sourceFile: string }> {
  if (!shared.id || shared.id.includes('/') || shared.id.includes('\\') || shared.id === '.' || shared.id === '..') {
    throw invalid('shared/pi-agent', 'shared skill id is invalid')
  }
  const sourceFile = resolve(shared.skillFile)
  let skillFile: string
  try {
    skillFile = await realpath(sourceFile)
  } catch (error) {
    if (!isExpectedPathAdmissionError(error)) throw error
    throw invalid('shared/pi-agent', 'shared skill is not readable')
  }
  if (posix.basename(skillFile.split(sep).join('/')) !== 'SKILL.md') {
    throw invalid('shared/pi-agent', 'shared skill must name a SKILL.md file')
  }
  const skill = await resolveSkillRecord({
    packageName: 'shared/pi-agent',
    sourceSkillFile: skillFile,
    logicalFile: `shared/pi-agent/${shared.id}/SKILL.md`,
  })
  return { ...skill, sourceFile }
}

function assertNoOverlappingLogicalRoots(drafts: readonly ResolvedSkillDraft[]): void {
  const logicalRoots = drafts.map((skill) => posix.dirname(skill.resource.path))
  for (let i = 0; i < logicalRoots.length; i++) {
    for (let j = i + 1; j < logicalRoots.length; j++) {
      if (rootsOverlap(logicalRoots[i], logicalRoots[j])) {
        throw conflict(drafts[j].packageName, 'logical skill mounts overlap')
      }
    }
  }
}

export async function resolveWorkspacePackageResources(
  contributions: readonly WorkspacePackageResourceRecord[],
  options: ResolveWorkspacePackageResourcesOptions = {},
): Promise<{
  readonly registry: ResolvedWorkspacePackageResourceRegistry
  readonly diagnostics: readonly PackageResourceDiagnostic[]
}> {
  const skippableContributions = options.skippableContributions ?? []
  // Package skips are reported in skippable-input order regardless of which
  // phase rejected them, so callers see one stable diagnostic sequence.
  const packageSkips: { order: number; entry: SkippedWorkspacePackageResource }[] = []
  const sharedSkips: SkippedWorkspacePackageResource[] = []

  // Phase 1 — independent admission. Required entries fail the resolve; a
  // skippable entry is dropped here and never touched again.
  const admitted: AdmittedContribution[] = []
  const admitInto = async (records: readonly WorkspacePackageResourceRecord[], skippable: boolean) => {
    for (const [order, contribution] of records.entries()) {
      try {
        const { canonicalRoot, manifest } = await admitContribution(contribution)
        admitted.push({ contribution, canonicalRoot, manifest, skippable, order })
      } catch (error) {
        if (!skippable) throw error
        const refusal = admissionRefusal(error)
        if (!refusal) throw error
        packageSkips.push({
          order,
          entry: { kind: 'package-contribution', id: contribution.packageName, ...refusal },
        })
      }
    }
  }
  await admitInto(contributions, false)
  await admitInto(skippableContributions, true)

  // Phase 2 — resolve each distinct package root's skills exactly once. A root
  // whose only claimants are skippable is dropped whole; one required claimant
  // makes the failure fatal, as it is today.
  const draftsByPackage = new Map<string, ResolvedSkillDraft[]>()
  const surviving: AdmittedContribution[] = []
  const droppedKeys = new Map<string, { code: string; message: string }>()
  const requiredKeys = new Set(admitted
    .filter((entry) => !entry.skippable)
    .map((entry) => packageKey(entry.contribution.packageName, entry.canonicalRoot)))
  for (const entry of admitted) {
    const key = packageKey(entry.contribution.packageName, entry.canonicalRoot)
    const alreadyDropped = droppedKeys.get(key)
    if (alreadyDropped) {
      packageSkips.push({
        order: entry.order,
        entry: { kind: 'package-contribution', id: entry.contribution.packageName, ...alreadyDropped },
      })
      continue
    }
    if (!draftsByPackage.has(key)) {
      try {
        draftsByPackage.set(key, await resolvePackageSkills(
          entry.contribution.packageName,
          entry.canonicalRoot,
          entry.manifest,
        ))
      } catch (error) {
        if (requiredKeys.has(key)) throw error
        const refusal = admissionRefusal(error)
        if (!refusal) throw error
        droppedKeys.set(key, refusal)
        packageSkips.push({
          order: entry.order,
          entry: { kind: 'package-contribution', id: entry.contribution.packageName, ...refusal },
        })
        continue
      }
    }
    surviving.push(entry)
  }

  // Phase 3 — assemble. Cross-entry conflicts are decided here, over survivors
  // only, in contribution order.
  const packageRecords = new Map<string, {
    root: string
    manifest: PackageManifest
    pluginIds: Set<string>
  }>()
  for (const { contribution, canonicalRoot, manifest } of surviving) {
    const existingForName = packageRecords.get(contribution.packageName)?.root
    if (existingForName && existingForName !== canonicalRoot) {
      throw conflict(contribution.packageName, 'one package name resolved to multiple roots')
    }
    const existingAtRoot = [...packageRecords.entries()].find(([, record]) => record.root === canonicalRoot)
    if (existingAtRoot && existingAtRoot[0] !== contribution.packageName) {
      throw conflict(contribution.packageName, 'one package root was claimed by multiple names')
    }
    const record = packageRecords.get(contribution.packageName) ?? {
      root: canonicalRoot,
      manifest,
      pluginIds: new Set<string>(),
    }
    record.pluginIds.add(contribution.pluginId)
    packageRecords.set(contribution.packageName, record)
  }

  const skills: ResolvedAgentPackageSkill[] = []
  for (const [packageName, record] of [...packageRecords.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pluginIds = [...record.pluginIds].sort()
    for (const draft of draftsByPackage.get(packageKey(packageName, record.root)) ?? []) {
      skills.push({ ...draft, pluginIds })
    }
  }

  const sharedLocatorAliases = new Map<string, AgentSkillResource>()

  /**
   * Single resolution point for one shared-skill entry. Resolves the record
   * exactly once and reports an admission verdict as a typed skip instead of
   * throwing; any other error propagates (gh-1196: a resolver defect must
   * surface, not masquerade as a stale symlink).
   */
  const resolveSharedSkillRecord = async (
    shared: SharedSkillPath,
  ): Promise<
    | { readonly kind: 'resolved'; readonly skill: Omit<Awaited<ReturnType<typeof resolveSharedSkill>>, 'sourceFile'>; readonly sourceFile: string }
    | { readonly kind: 'skipped'; readonly id: string; readonly code: string; readonly message: string }
  > => {
    try {
      const { sourceFile, ...skill } = await resolveSharedSkill(shared)
      return { kind: 'resolved', skill, sourceFile }
    } catch (error) {
      const refusal = admissionRefusal(error)
      if (!refusal) throw error
      return { kind: 'skipped', id: shared.id, ...refusal }
    }
  }

  const admitShared = async (entries: readonly SharedSkillPath[], skippable: boolean) => {
    for (const shared of entries) {
      const outcome = await resolveSharedSkillRecord(shared)
      if (outcome.kind === 'skipped') {
        if (!skippable) throw new WorkspacePackageResourceRegistryError(
          outcome.code as typeof PACKAGE_RESOURCE_INVALID_CODE,
          'shared/pi-agent',
          outcome.message,
        )
        sharedSkips.push({ kind: 'shared-skill', id: outcome.id, code: outcome.code, message: outcome.message })
        continue
      }
      sharedLocatorAliases.set(outcome.sourceFile, outcome.skill.resource)
      skills.push({ ...outcome.skill, pluginIds: ['host:shared-skill'] })
    }
  }
  await admitShared(options.sharedSkillPaths ?? [], false)
  await admitShared(options.skippableSharedSkillPaths ?? [], true)

  const logicalRoots = skills.map((skill) => posix.dirname(skill.resource.path))
  for (let i = 0; i < logicalRoots.length; i++) {
    for (let j = i + 1; j < logicalRoots.length; j++) {
      if (rootsOverlap(logicalRoots[i], logicalRoots[j])) {
        throw conflict(skills[j].packageName, 'logical skill mounts overlap')
      }
    }
  }

  const systemPrompts: Array<{ pluginIds: string[]; content: string }> = []
  for (const record of packageRecords.values()) {
    const content = typeof record.manifest.pi?.systemPrompt === 'string'
      ? record.manifest.pi.systemPrompt.trim()
      : ''
    if (!content) continue
    const existing = systemPrompts.find((prompt) => prompt.content === content)
    if (existing) {
      existing.pluginIds = [...new Set([...existing.pluginIds, ...record.pluginIds])].sort()
    } else {
      systemPrompts.push({ pluginIds: [...record.pluginIds].sort(), content })
    }
  }

  const generationHash = createHash('sha256')
  generationHash.update(JSON.stringify(systemPrompts))
  generationHash.update('\0')
  const locatorByFile = new Map<string, AgentSkillResource>(sharedLocatorAliases)
  for (const skill of skills) {
    generationHash.update(JSON.stringify({
      packageName: skill.packageName,
      pluginIds: skill.pluginIds,
      skillFile: skill.resource.path,
      name: skill.name,
      description: skill.description,
    }))
    generationHash.update('\0')
    locatorByFile.set(skill.skillFile, skill.resource)
  }

  // Typed skip diagnostics are assembled here, at the single point that knows
  // both skip kinds — callers never see a `skipped` bag to reinterpret.
  const diagnostics: PackageResourceDiagnostic[] = [
    ...packageSkips.sort((left, right) => left.order - right.order).map(({ entry }): PackageResourceDiagnostic => ({
      source: 'package-resource-scan',
      message: entry.message,
      pluginId: entry.id,
      code: entry.code,
    })),
    ...sharedSkips.map((entry): PackageResourceDiagnostic => ({
      source: 'shared-skill-scan',
      message: `shared skill "${entry.id}" was not admissible and was skipped: ${entry.message}`,
      pluginId: 'shared/pi-agent',
      code: entry.code,
    })),
  ]

  return {
    diagnostics,
    registry: {
    generation: generationHash.digest('hex'),
    additionalSkillPaths: [...new Set(skills
      .filter((skill) => skill.packageName !== 'shared/pi-agent')
      .map((skill) => skill.mountRoot))],
    skills,
    managedSkills: skills
      .filter((skill): skill is typeof skill & { name: string } => typeof skill.name === 'string')
      .map((skill) => ({
        name: skill.name,
        description: skill.description ?? '',
        resource: skill.resource,
        invocable: false,
        source: skill.packageName,
      })),
    handledPackageRoots: [...packageRecords.values()].map((record) => record.root).sort(),
    readonlyMounts: skills.map((skill) => ({
      logicalRoot: posix.dirname(skill.resource.path),
      sourceRoot: skill.mountRoot,
    })),
    systemPrompts,
    locateSkill(filePath) {
      return locatorByFile.get(resolve(filePath))
    },
    },
  }
}

export interface PackageResourceScanSource {
  readonly id?: string
  readonly rootDir: string
}

export interface PackageResourceDiagnostic {
  readonly source: string
  readonly message: string
  readonly pluginId?: string
  /** The admission verdict that caused the entry to be skipped, when there was one. */
  readonly code?: string
}

/**
 * Speculative package/shared-skill inputs may degrade only when the host
 * explicitly declines to admit them. `SKIPPABLE_RESOURCE_CODES` carries the
 * path-admission verdicts shared with the digest layer;
 * `PACKAGE_RESOURCE_INVALID_CODE` is this layer's own validated-input verdict.
 * Anything else — a conflict, TypeError, EACCES, or resolver defect — must
 * propagate rather than masquerade as a routine skip.
 */
// Kept in deliberate lockstep with the digest layer's skippable
// path-admission verdicts (piResourceDigest.ts) without a cross-layer
// export: workspace admission adds its own not-a-skill verdict below.
const RESOURCE_ADMISSION_CODES: ReadonlySet<string> = new Set<string>([
  'PATH_ESCAPE',
  'PATH_SYMLINK_ESCAPE',
  PACKAGE_RESOURCE_INVALID_CODE,
])

function resourceAdmissionCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && RESOURCE_ADMISSION_CODES.has(code) ? code : undefined
}

export function packageResourceHandlesPath(
  path: string | URL,
  roots: readonly string[],
): boolean {
  const source = path instanceof URL ? fileURLToPath(path) : path
  let target: string
  try { target = realpathSync(source) } catch { target = resolve(source) }
  return roots.some((root) => isInside(root, target))
}

export function packageResourceSystemPrompt(
  registry: ResolvedWorkspacePackageResourceRegistry,
): string | undefined {
  return registry.systemPrompts.map((prompt) => prompt.content).join('\n\n') || undefined
}

export async function discoverPackageResourceRecords(
  sources: readonly PackageResourceScanSource[],
): Promise<WorkspacePackageResourceRecord[]> {
  const records: WorkspacePackageResourceRecord[] = []
  for (const source of sources) {
    try {
      const manifest = parseManifest('scanned-package', await readFile(join(source.rootDir, 'package.json'), 'utf8'))
      if (typeof manifest.name !== 'string' || !Array.isArray(manifest.pi?.skills) || manifest.pi.skills.length === 0) continue
      records.push({
        pluginId: `package-scan:${source.id ?? manifest.name}`,
        packageName: manifest.name,
        packageRoot: source.rootDir,
      })
    } catch {
      // Existing plugin diagnostics own malformed speculative scan roots.
    }
  }
  return records
}

export async function enumerateExternalSkillFiles(
  paths: readonly string[],
  workspaceRoot: string,
): Promise<Array<{ id: string; skillFile: string }>> {
  const workspace = await realpath(resolve(workspaceRoot)).catch(() => resolve(workspaceRoot))
  const files = new Map<string, { id: string; skillFile: string }>()
  const add = async (candidate: string) => {
    const skillFile = await realpath(candidate).catch(() => undefined)
    if (!skillFile || isInside(workspace, skillFile)) return
    const id = basename(dirname(skillFile))
    if (!files.has(id)) files.set(id, { id, skillFile: resolve(candidate) })
  }
  for (const input of paths) {
    const inputStat = await stat(input).catch(() => undefined)
    if (!inputStat) continue
    if (inputStat.isFile()) {
      if (basename(input).toLowerCase() === 'skill.md') await add(input)
      continue
    }
    if (!inputStat.isDirectory()) continue
    if ((await stat(join(input, 'SKILL.md')).catch(() => undefined))?.isFile()) {
      await add(join(input, 'SKILL.md'))
      continue
    }
    for (const child of await readdir(input).catch(() => [])) await add(join(input, child, 'SKILL.md'))
  }
  return [...files.values()]
}

export async function resolveWorkspacePackageResourceSnapshot<TBinding = never>(input: {
  readonly declared: readonly WorkspacePackageResourceRecord[]
  readonly scanned: readonly WorkspacePackageResourceRecord[]
  readonly sharedSkillPaths?: readonly { readonly id: string; readonly skillFile: string }[]
  readonly createBinding?: (mounts: readonly AgentResourceReadonlyMount[]) => Promise<TBinding>
}): Promise<{
  readonly registry: ResolvedWorkspacePackageResourceRegistry
  readonly binding?: TBinding
  readonly diagnostics: readonly PackageResourceDiagnostic[]
}> {
  // Scanned packages and ambient shared skills are speculative: an entry the
  // resolver will not admit is skipped with a diagnostic and is never resolved,
  // opened or exposed, while the rest still load. gh-1196: ~/.pi/agent/skills is
  // normally a tree of symlinks into other roots, so one stale entry there is
  // routine, and failing the whole scan closed used to 500 every agent-scoped
  // route. The resolver reports these per entry in a single pass — do not
  // reintroduce a probe that re-runs it once per candidate.
  const { registry, diagnostics } = await resolveWorkspacePackageResources(input.declared, {
    skippableContributions: input.scanned,
    skippableSharedSkillPaths: input.sharedSkillPaths ?? [],
  })
  const binding = registry.readonlyMounts.length > 0 && input.createBinding
    ? await input.createBinding(registry.readonlyMounts)
    : undefined
  return Object.freeze({ registry, ...(binding ? { binding } : {}), diagnostics })
}
