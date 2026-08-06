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

function frontmatterValue(content: string, key: string): string | undefined {
  if (!content.startsWith('---\n')) return undefined
  const end = content.indexOf('\n---', 4)
  if (end < 0) return undefined
  const line = content.slice(4, end).split('\n').find((entry) => entry.startsWith(`${key}:`))
  const value = line?.slice(key.length + 1).trim()
  return value || undefined
}

async function resolveSkillRecord(input: {
  packageName: string
  pluginIds: readonly string[]
  sourceSkillFile: string
  logicalFile: string
  packageRoot?: string
}): Promise<ResolvedAgentPackageSkill> {
  if (!(await stat(input.sourceSkillFile).catch(() => null))?.isFile()) {
    throw invalid(input.packageName, 'declared skill has no SKILL.md file')
  }
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
  return {
    packageName: input.packageName,
    pluginIds: input.pluginIds,
    skillFile,
    mountRoot,
    resource: { filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: input.logicalFile },
    ...(frontmatterValue(content, 'name') ? { name: frontmatterValue(content, 'name') } : {}),
    ...(frontmatterValue(content, 'description') ? { description: frontmatterValue(content, 'description') } : {}),
  }
}

async function resolveSkillDeclaration(
  packageName: string,
  canonicalPackageRoot: string,
  declaration: string,
  pluginIds: readonly string[],
): Promise<ResolvedAgentPackageSkill> {
  const declaredPath = resolve(canonicalPackageRoot, ...declaration.split('/'))
  if (!isInside(canonicalPackageRoot, declaredPath)) throw invalid(packageName, 'pi.skills entry escapes package root')
  const declaredStat = await stat(declaredPath).catch(() => null)
  if (!declaredStat) throw invalid(packageName, 'pi.skills entry does not exist')
  const directFile = declaredStat.isFile() && posix.basename(declaration) === 'SKILL.md'
  if (!declaredStat.isDirectory() && !directFile) {
    throw invalid(packageName, 'pi.skills entry must be a skill directory or SKILL.md file')
  }
  const relativeSkillFile = directFile ? declaration : `${declaration}/SKILL.md`
  return resolveSkillRecord({
    packageName,
    pluginIds,
    sourceSkillFile: resolve(canonicalPackageRoot, ...relativeSkillFile.split('/')),
    logicalFile: `packages/${packageName}/${relativeSkillFile}`,
    packageRoot: canonicalPackageRoot,
  })
}

function rootsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export async function resolveWorkspacePackageResources(
  contributions: readonly WorkspacePackageResourceRecord[],
  options: {
    sharedSkillPaths?: readonly { readonly id: string; readonly skillFile: string }[]
  } = {},
): Promise<ResolvedWorkspacePackageResourceRegistry> {
  const packageRecords = new Map<string, {
    root: string
    manifest: PackageManifest
    pluginIds: Set<string>
  }>()

  for (const contribution of contributions) {
    const requestedRoot = packageRootPath(contribution.packageRoot, contribution.packageName)
    const canonicalRoot = await realpath(requestedRoot).catch(() => {
      throw invalid(contribution.packageName, 'packageRoot is not readable')
    })
    const existingForName = packageRecords.get(contribution.packageName)?.root
    if (existingForName && existingForName !== canonicalRoot) {
      throw conflict(contribution.packageName, 'one package name resolved to multiple roots')
    }

    const manifestBytes = await readFile(resolve(canonicalRoot, 'package.json'), 'utf8').catch(() => {
      throw invalid(contribution.packageName, 'package manifest is not readable')
    })
    const manifest = parseManifest(contribution.packageName, manifestBytes)
    if (manifest.name !== contribution.packageName) {
      throw invalid(contribution.packageName, 'package manifest name does not match contribution')
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
    const manifest = record.manifest
    if (!Array.isArray(manifest.pi?.skills) || manifest.pi.skills.length === 0) {
      throw invalid(packageName, 'package manifest must declare pi.skills')
    }
    const declarations = [...new Set(manifest.pi.skills.map((entry) => normalizeDeclaration(packageName, entry)))]
    for (const declaration of declarations.sort()) {
      skills.push(await resolveSkillDeclaration(
        packageName,
        record.root,
        declaration,
        [...record.pluginIds].sort(),
      ))
    }
  }

  const sharedLocatorAliases = new Map<string, AgentSkillResource>()
  for (const shared of options.sharedSkillPaths ?? []) {
    if (!shared.id || shared.id.includes('/') || shared.id.includes('\\') || shared.id === '.' || shared.id === '..') {
      throw invalid('shared/pi-agent', 'shared skill id is invalid')
    }
    const sourceFile = resolve(shared.skillFile)
    const skillFile = await realpath(sourceFile).catch(() => {
      throw invalid('shared/pi-agent', 'shared skill is not readable')
    })
    if (posix.basename(skillFile.split(sep).join('/')) !== 'SKILL.md') {
      throw invalid('shared/pi-agent', 'shared skill must name a SKILL.md file')
    }
    const skill = await resolveSkillRecord({
      packageName: 'shared/pi-agent',
      pluginIds: ['host:shared-skill'],
      sourceSkillFile: skillFile,
      logicalFile: `shared/pi-agent/${shared.id}/SKILL.md`,
    })
    sharedLocatorAliases.set(sourceFile, skill.resource)
    skills.push(skill)
  }

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

  return {
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

export async function resolveWorkspacePackageResourceSnapshot<TBinding>(input: {
  readonly declared: readonly WorkspacePackageResourceRecord[]
  readonly scanned: readonly WorkspacePackageResourceRecord[]
  readonly sharedSkillPaths?: readonly { readonly id: string; readonly skillFile: string }[]
  readonly createBinding: (mounts: readonly AgentResourceReadonlyMount[]) => Promise<TBinding>
}): Promise<{
  readonly registry: ResolvedWorkspacePackageResourceRegistry
  readonly binding?: TBinding
  readonly diagnostics: readonly PackageResourceDiagnostic[]
}> {
  const accepted: WorkspacePackageResourceRecord[] = []
  const diagnostics: PackageResourceDiagnostic[] = []
  for (const record of input.scanned) {
    try {
      await resolveWorkspacePackageResources([record])
      accepted.push(record)
    } catch {
      diagnostics.push({
        source: 'package-resource-scan',
        message: 'scanned package skill resources were invalid',
        pluginId: record.packageName,
      })
    }
  }
  const registry = await resolveWorkspacePackageResources([...input.declared, ...accepted], {
    sharedSkillPaths: input.sharedSkillPaths,
  })
  const binding = registry.readonlyMounts.length > 0
    ? await input.createBinding(registry.readonlyMounts)
    : undefined
  return Object.freeze({ registry, ...(binding ? { binding } : {}), diagnostics })
}
