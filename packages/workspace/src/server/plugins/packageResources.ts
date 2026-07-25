import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'

import {
  AGENT_RESOURCES_FILESYSTEM_ID,
  type AgentSkillResource,
} from '@hachej/boring-agent/shared'

import type { WorkspacePackageResourceRecord } from './bootstrapServer'

export const PACKAGE_RESOURCE_INVALID_CODE = 'PACKAGE_RESOURCE_INVALID'
export const PACKAGE_RESOURCE_CONFLICT_CODE = 'PACKAGE_RESOURCE_CONFLICT'

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
  pi?: { skills?: unknown }
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
  /** Canonical server-only path supplied to Pi. It may differ from mountRoot. */
  readonly piSkillPath: string
  readonly resource: AgentSkillResource
  readonly name?: string
  readonly description?: string
}

export interface AgentResourceReadonlyMount {
  readonly logicalRoot: string
  readonly sourceRoot: string
}

export interface ResolvedWorkspacePackageResourceRegistry {
  readonly generation: string
  readonly additionalSkillPaths: readonly string[]
  readonly skills: readonly ResolvedAgentPackageSkill[]
  readonly readonlyMounts: readonly AgentResourceReadonlyMount[]
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
  if (declaration.includes('\0') || declaration.includes('\\') || isAbsolute(declaration)) {
    throw invalid(packageName, 'pi.skills entry must be a normalized relative path')
  }
  const segments = declaration.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalid(packageName, 'pi.skills entry contains an invalid path segment')
  }
  if (/%(?:2e|2f|5c)/i.test(declaration) || /^[a-z][a-z0-9+.-]*:/i.test(declaration)) {
    throw invalid(packageName, 'pi.skills entry contains an encoded or URL path')
  }
  const normalized = posix.normalize(declaration)
  if (normalized !== declaration) throw invalid(packageName, 'pi.skills entry is not normalized')
  return normalized
}

function frontmatterValue(content: string, key: string): string | undefined {
  if (!content.startsWith('---\n')) return undefined
  const end = content.indexOf('\n---', 4)
  if (end < 0) return undefined
  const line = content.slice(4, end).split('\n').find((entry) => entry.startsWith(`${key}:`))
  const value = line?.slice(key.length + 1).trim()
  return value || undefined
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

  let sourceSkillFile: string
  let manifestRelativeSkillFile: string
  if (declaredStat.isDirectory()) {
    sourceSkillFile = resolve(declaredPath, 'SKILL.md')
    manifestRelativeSkillFile = `${declaration}/SKILL.md`
  } else if (declaredStat.isFile() && posix.basename(declaration) === 'SKILL.md') {
    sourceSkillFile = declaredPath
    manifestRelativeSkillFile = declaration
  } else {
    throw invalid(packageName, 'pi.skills entry must be a skill directory or SKILL.md file')
  }

  const skillFileStat = await stat(sourceSkillFile).catch(() => null)
  if (!skillFileStat?.isFile()) throw invalid(packageName, 'declared skill has no SKILL.md file')

  const [skillFile, mountRoot] = await Promise.all([
    realpath(sourceSkillFile),
    realpath(dirname(sourceSkillFile)),
  ])
  if (!isInside(canonicalPackageRoot, skillFile) || !isInside(canonicalPackageRoot, mountRoot)) {
    throw invalid(packageName, 'declared skill resolves outside package root')
  }
  if (mountRoot === canonicalPackageRoot) {
    throw invalid(packageName, 'declared skill root must be below the package root')
  }
  if (!isInside(mountRoot, skillFile)) throw invalid(packageName, 'SKILL.md resolves outside declared skill root')

  const piSkillPath = mountRoot
  if (!isInside(canonicalPackageRoot, piSkillPath)) {
    throw invalid(packageName, 'Pi skill path resolves outside package root')
  }
  const logicalFile = `packages/${packageName}/${manifestRelativeSkillFile}`
  const content = await readFile(skillFile, 'utf8')
  return {
    packageName,
    pluginIds,
    skillFile,
    mountRoot,
    piSkillPath,
    resource: {
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      path: logicalFile,
    },
    ...(frontmatterValue(content, 'name') ? { name: frontmatterValue(content, 'name') } : {}),
    ...(frontmatterValue(content, 'description') ? { description: frontmatterValue(content, 'description') } : {}),
  }
}

function rootsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export async function resolveWorkspacePackageResources(
  contributions: readonly WorkspacePackageResourceRecord[],
): Promise<ResolvedWorkspacePackageResourceRegistry> {
  const rootsByPackage = new Map<string, string>()
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
    const existingForName = rootsByPackage.get(contribution.packageName)
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

    rootsByPackage.set(contribution.packageName, canonicalRoot)
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

  const logicalRoots = skills.map((skill) => posix.dirname(skill.resource.path))
  for (let i = 0; i < logicalRoots.length; i++) {
    for (let j = i + 1; j < logicalRoots.length; j++) {
      if (rootsOverlap(logicalRoots[i], logicalRoots[j])) {
        throw conflict(skills[j].packageName, 'logical skill mounts overlap')
      }
    }
  }

  const generationHash = createHash('sha256')
  const locatorByFile = new Map<string, AgentSkillResource>()
  for (const skill of skills) {
    generationHash.update(JSON.stringify({
      packageName: skill.packageName,
      pluginIds: skill.pluginIds,
      skillFile: skill.resource.path,
      piSkillPath: relative(skill.mountRoot, skill.piSkillPath).split(sep).join('/'),
    }))
    generationHash.update('\0')
    generationHash.update(await readFile(skill.skillFile))
    generationHash.update('\0')
    locatorByFile.set(skill.skillFile, skill.resource)
  }

  return {
    generation: generationHash.digest('hex'),
    additionalSkillPaths: [...new Set(skills.map((skill) => skill.piSkillPath))],
    skills,
    readonlyMounts: skills.map((skill) => ({
      logicalRoot: posix.dirname(skill.resource.path),
      sourceRoot: skill.mountRoot,
    })),
    locateSkill(filePath) {
      return locatorByFile.get(resolve(filePath))
    },
  }
}
