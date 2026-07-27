/**
 * GET /api/v1/agent/skills
 *
 * Returns the list of PI skills discovered for the current workspace —
 * global skills (~/.pi/agent/skills) plus any project-local SKILL.md files.
 * The front-end uses this to populate the slash-command picker without
 * host apps having to hardcode skill names in extraCommands.
 *
 * Shape:
 *   { skills: [{ name: string, description: string }] }
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
  parseFrontmatter,
} from '@mariozechner/pi-coding-agent'
import type { PiPackageSource } from '../../piPackages'
import type { AgentSkillResource } from '../../../shared/skill-resource'
import type { RuntimeFilesystemBinding } from '../../runtime/mode'
import { ErrorCode } from '../../../shared/error-codes'
import type { Workspace } from '../../../shared/workspace'
import { createResourceSettingsManager, withPiHarnessDefaults } from '../../harness/pi-coding-agent/createHarness'

export interface SkillSummary {
  name: string
  description: string
  /** Browser-safe locator for opening a supported skill source. */
  resource?: AgentSkillResource
  /** Transitional compatibility for workspace-relative user skills only. */
  filePath?: string
  /** False for management-only rows that Pi did not retain as invocable. */
  invocable?: boolean
  /** Filesystem skills are expanded through a fresh authorized server read. */
  invocation?: 'filesystem'
  /** Human-readable source/scope label for diagnostics and disabled rows. */
  source?: string
}

export interface AgentSkillResourceSnapshot {
  readonly generation: string
  readonly managedSkills: readonly SkillSummary[]
  locateSkill(filePath: string): AgentSkillResource | undefined
}

interface SkillsQuery {
  refresh?: string
}

interface FilesystemSkill {
  summary: SkillSummary & { resource: AgentSkillResource; invocation: 'filesystem' }
  content: string
}

const CACHE_TTL_MS = 30_000
const FILESYSTEM_SKILLS_ROOT = '.agents/skills'
const MAX_SKILL_BYTES = 256 * 1024
const MAX_SKILLS_PER_FILESYSTEM = 128
const SAFE_SKILL_SEGMENT = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function isSafeSkillSegment(value: string): boolean {
  return SAFE_SKILL_SEGMENT.test(value)
}

async function canRead(binding: RuntimeFilesystemBinding, path: string): Promise<boolean> {
  // Path-capability-aware bindings may refine the scalar read grant. Keep the
  // structural check compatible with bindings whose operations are the only
  // read authority.
  const resolveAccess = (binding.operations as RuntimeFilesystemBinding['operations'] & {
    resolveAccess?: (descriptor: { filesystem: string; path: string }) => Promise<{ capabilities: { read: boolean } }>
  }).resolveAccess
  if (!resolveAccess) return true
  try {
    return (await resolveAccess({ filesystem: binding.filesystem, path })).capabilities.read
  } catch {
    return false
  }
}

function parseFilesystemSkill(content: string, fallbackName: string): { name: string; description: string } | undefined {
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) return undefined
  try {
    const { frontmatter } = parseFrontmatter<{ name?: unknown; description?: unknown }>(content)
    const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : fallbackName
    const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''
    if (!isSafeSkillSegment(name) || !description) return undefined
    return { name, description }
  } catch {
    return undefined
  }
}

async function readFilesystemSkill(
  binding: RuntimeFilesystemBinding,
  skillId: string,
): Promise<FilesystemSkill | undefined> {
  if (!isSafeSkillSegment(skillId)) return undefined
  const folderPath = `${FILESYSTEM_SKILLS_ROOT}/${skillId}`
  const filePath = `${folderPath}/SKILL.md`
  try {
    if (!await canRead(binding, FILESYSTEM_SKILLS_ROOT)
      || !await canRead(binding, folderPath)
      || !await canRead(binding, filePath)) return undefined
    if (!(await binding.operations.stat({ filesystem: binding.filesystem, path: folderPath })).isDirectory) return undefined
    const { content } = await binding.operations.read({ filesystem: binding.filesystem, path: filePath })
    const metadata = parseFilesystemSkill(content, skillId)
    if (!metadata) return undefined
    return {
      content,
      summary: {
        ...metadata,
        resource: { filesystem: binding.filesystem, path: filePath },
        invocation: 'filesystem',
        source: binding.filesystem,
      },
    }
  } catch {
    return undefined
  }
}

async function discoverFilesystemSkills(bindings: readonly RuntimeFilesystemBinding[]): Promise<FilesystemSkill[]> {
  const discovered: FilesystemSkill[] = []
  for (const binding of [...bindings].sort((left, right) => left.filesystem.localeCompare(right.filesystem))) {
    try {
      if (!await canRead(binding, FILESYSTEM_SKILLS_ROOT)) continue
      if (!(await binding.operations.stat({ filesystem: binding.filesystem, path: FILESYSTEM_SKILLS_ROOT })).isDirectory) continue
      const { entries } = await binding.operations.list({ filesystem: binding.filesystem, path: FILESYSTEM_SKILLS_ROOT })
      for (const skillId of [...entries].sort().slice(0, MAX_SKILLS_PER_FILESYSTEM)) {
        const skill = await readFilesystemSkill(binding, skillId)
        if (skill) discovered.push(skill)
      }
    } catch {
      // A missing or denied conventional skill root contributes no skills.
    }
  }
  return discovered
}

async function filesystemBindingsForRequest(
  resolver: SkillsRoutesOptions['getFilesystemBindings'],
  request: FastifyRequest,
): Promise<RuntimeFilesystemBinding[]> {
  try {
    return await resolver?.(request) ?? []
  } catch {
    // Binding resolution is fail-closed for cross-filesystem skills and must
    // not suppress unrelated native Pi skills.
    return []
  }
}

function expandedFilesystemSkill(skill: FilesystemSkill, args: string): string {
  const request = args.trim()
  return [
    `skill: ${skill.summary.name}`,
    'Follow the freshly authorized skill instructions below.',
    `Authorized source: ${JSON.stringify(skill.summary.resource)}`,
    `Resolve relative references against .agents/skills/${skill.summary.resource.path.split('/')[2]} in the ${skill.summary.resource.filesystem} filesystem.`,
    '--- BEGIN SKILL INSTRUCTIONS ---',
    skill.content,
    '--- END SKILL INSTRUCTIONS ---',
    ...(request ? ['User request:', request] : []),
  ].join('\n')
}

function pathForWorkspaceEditor(workspaceRoot: string, filePath: string): string | undefined {
  const pathWithinWorkspace = relative(resolve(workspaceRoot), resolve(filePath))
  if (pathWithinWorkspace === '' || pathWithinWorkspace === '..' || pathWithinWorkspace.startsWith(`..${sep}`) || isAbsolute(pathWithinWorkspace)) {
    return undefined
  }
  return pathWithinWorkspace.split(sep).join('/')
}

function resourceKey(resource: AgentSkillResource): string {
  return `${resource.filesystem}\0${resource.path}`
}

export interface SkillsRoutesOptions {
  workspace?: Workspace
  additionalSkillPaths?: string[]
  piPackages?: PiPackageSource[]
  noSkills?: boolean
  getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
  getAdditionalSkillPaths?: (request: FastifyRequest) => string[] | undefined | Promise<string[] | undefined>
  getPiPackages?: (request: FastifyRequest) => PiPackageSource[] | undefined | Promise<PiPackageSource[] | undefined>
  getNoSkills?: (request: FastifyRequest) => boolean | undefined | Promise<boolean | undefined>
  getSkillResourceSnapshot?: (request: FastifyRequest) => AgentSkillResourceSnapshot | undefined | Promise<AgentSkillResourceSnapshot | undefined>
  getFilesystemBindings?: (request: FastifyRequest) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
}

export function skillsRoutes(
  app: FastifyInstance,
  opts: SkillsRoutesOptions,
  done: (err?: Error) => void,
): void {
  const cached = new Map<string, { skills: SkillSummary[]; expiresAt: number }>()

  async function resolveSkillsForRequest(request: FastifyRequest, refresh = false) {
    const workspace = opts.getWorkspace
      ? await opts.getWorkspace(request)
      : opts.workspace
    if (!workspace) throw new Error('skills route requires workspace or getWorkspace')
    const workspaceRoot = workspace.root
    const additionalSkillPaths = opts.getAdditionalSkillPaths
      ? await opts.getAdditionalSkillPaths(request)
      : opts.additionalSkillPaths
    const piPackages = opts.getPiPackages
      ? await opts.getPiPackages(request)
      : opts.piPackages
    // Capture the locator/catalog generation once so this response cannot mix
    // management rows and locators from different reload snapshots.
    const resourceSnapshot = await opts.getSkillResourceSnapshot?.(request)
    const filesystemBindings = await filesystemBindingsForRequest(opts.getFilesystemBindings, request)
    const filesystemSkills = await discoverFilesystemSkills(filesystemBindings)
    // `undefined` means the host didn't say — resolve through the canonical
    // harness policy so a bare registration can't silently flip ambient
    // skill discovery on.
    const noSkills = (opts.getNoSkills
      ? await opts.getNoSkills(request)
      : opts.noSkills) ?? withPiHarnessDefaults().noSkills
    const cacheKey = JSON.stringify([workspaceRoot, additionalSkillPaths ?? [], piPackages ?? [], noSkills, resourceSnapshot?.generation ?? null])
    const now = Date.now()
    for (const [key, entry] of cached) {
      if (entry.expiresAt <= now) cached.delete(key)
    }
    const cachedEntry = cached.get(cacheKey)
    // Path-level access can change without changing a binding's scalar identity.
    if (filesystemBindings.length === 0 && !refresh && cachedEntry && cachedEntry.expiresAt > now) return cachedEntry

    const agentDir = getAgentDir()
    const packageSkillPaths = noSkills
      ? []
      : await (async () => {
          const settingsManager = createResourceSettingsManager(
            workspaceRoot,
            agentDir,
            piPackages ?? [],
          )
          const packageManager = new DefaultPackageManager({
            cwd: workspaceRoot,
            agentDir,
            settingsManager,
          })
          const resolved = await packageManager.resolve()
          return resolved.skills
            .filter((resource) => resource.enabled)
            .map((resource) => resource.path)
        })()
    const result = loadSkills({
      cwd: workspaceRoot,
      agentDir,
      skillPaths: [...packageSkillPaths, ...(additionalSkillPaths ?? [])],
      includeDefaults: !noSkills,
    })
    const invocationSkills: SkillSummary[] = (result.skills as unknown as Array<Record<string, unknown>>).map((s) => {
      const absoluteFilePath = typeof s.filePath === 'string' ? s.filePath : undefined
      const workspacePath = absoluteFilePath ? pathForWorkspaceEditor(workspaceRoot, absoluteFilePath) : undefined
      const resource = absoluteFilePath
        ? resourceSnapshot?.locateSkill(absoluteFilePath) ?? (workspacePath ? { filesystem: 'user' as const, path: workspacePath } : undefined)
        : undefined
      return {
        name: String(s.name),
        description: String(s.description ?? ''),
        ...(resource ? { resource } : {}),
        ...(workspacePath && resource?.filesystem === 'user' ? { filePath: workspacePath } : {}),
        ...(typeof (s.sourceInfo as { scope?: unknown } | undefined)?.scope === 'string' ? { source: (s.sourceInfo as { scope: string }).scope } : {}),
      }
    })
    // Pinned Pi collapses duplicate frontmatter names. Preserve every admitted
    // management identity while leaving Pi's invocation winner untouched.
    const skills: SkillSummary[] = []
    const seenResources = new Set<string>()
    const invocableNames = new Set(invocationSkills.map((skill) => skill.name))
    const filesystemSummaries = filesystemSkills.map(({ summary }) => {
      if (invocableNames.has(summary.name)) return { ...summary, invocable: false }
      invocableNames.add(summary.name)
      return { ...summary, invocable: true }
    })
    const managementSkills = (resourceSnapshot?.managedSkills ?? []).map((skill) => ({
      ...skill,
      invocable: skill.invocable ?? false,
    }))
    for (const skill of [...invocationSkills, ...filesystemSummaries, ...managementSkills]) {
      if (skill.resource) {
        const key = resourceKey(skill.resource)
        if (seenResources.has(key)) continue
        seenResources.add(key)
      }
      skills.push(skill)
    }
    const entry = { skills, expiresAt: now + CACHE_TTL_MS }
    // Request-authorized filesystem metadata must never enter the shared
    // native-skill cache; another actor may have a different binding set.
    if (filesystemBindings.length === 0) cached.set(cacheKey, entry)
    return entry
  }

  app.get<{ Querystring: SkillsQuery }>('/api/v1/agent/skills', async (request, reply) => {
    try {
      const entry = await resolveSkillsForRequest(request, request.query.refresh === '1')
      return reply.code(200).send({ skills: entry.skills })
    } catch (error) {
      request.log.warn({ err: error }, '[agent] failed to load skills')
      // Still 200 so the slash-command picker keeps working. Never expose a
      // package-manager/loader error that may contain an absolute host path.
      return reply.code(200).send({
        skills: [],
        error: { code: ErrorCode.enum.SKILL_DISCOVERY_FAILED, message: 'skill discovery failed' },
      })
    }
  })

  app.post<{
    Body: { resource?: AgentSkillResource; args?: string }
  }>('/api/v1/agent/skills/invoke', async (request, reply) => {
    const resource = request.body?.resource
    const match = typeof resource?.path === 'string'
      ? /^\.agents\/skills\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/SKILL\.md$/.exec(resource.path)
      : null
    const bindings = await filesystemBindingsForRequest(opts.getFilesystemBindings, request)
    const binding = typeof resource?.filesystem === 'string'
      ? bindings.find((candidate) => candidate.filesystem === resource.filesystem)
      : undefined
    const catalog = await resolveSkillsForRequest(request, true)
    const selected = resource
      ? catalog.skills.find((candidate) => candidate.resource && resourceKey(candidate.resource) === resourceKey(resource))
      : undefined
    const skill = binding && match && selected?.invocable !== false && selected?.invocation === 'filesystem'
      ? await readFilesystemSkill(binding, match[1]!)
      : undefined
    if (!skill
      || skill.summary.resource.path !== resource?.path
      || skill.summary.name !== selected?.name) {
      return reply.code(403).send({
        error: { code: ErrorCode.enum.SKILL_DISCOVERY_FAILED, message: 'skill is unavailable' },
      })
    }
    return reply.code(200).send({
      name: skill.summary.name,
      resource: skill.summary.resource,
      expandedText: expandedFilesystemSkill(skill, typeof request.body?.args === 'string' ? request.body.args : ''),
    })
  })

  done()
}
