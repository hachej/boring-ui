/**
 * GET /api/v1/agents/:agentTypeId/skills
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
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
} from '@mariozechner/pi-coding-agent'
import type { PiPackageSource } from '../../piPackages'
import type { AgentSkillResource } from '../../../shared/skill-resource'
import { ErrorCode } from '../../../shared/error-codes'
import type { Workspace } from '../../../shared/workspace'
import { createResourceSettingsManager, withPiHarnessDefaults } from '../../harness/pi-coding-agent/createHarness'

export interface SkillSummary {
  name: string
  description: string
  /** Browser-safe locator for opening a supported skill source. */
  resource?: AgentSkillResource
  /** False for management-only rows that Pi did not retain as invocable. */
  invocable?: boolean
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

const CACHE_TTL_MS = 30_000

function provisionedWorkspaceRoots(additionalSkillPaths: readonly string[]): string[] {
  // Provisioning can contribute both runtime-visible and real-disk
  // <workspace root>/.agents/skills paths, so preserve every coordinate.
  const userSkillsSuffix = `${sep}.agents${sep}skills`
  return additionalSkillPaths
    .map((skillPath) => resolve(skillPath))
    .filter((skillPath) => skillPath.endsWith(userSkillsSuffix))
    .map((skillPath) => dirname(dirname(skillPath)))
}

export function pathForWorkspaceEditor(
  workspace: Pick<Workspace, 'root'>,
  filePath: string,
  additionalSkillPaths: readonly string[] = [],
): string {
  const roots = [workspace.root, ...provisionedWorkspaceRoots(additionalSkillPaths)]
  for (const root of roots) {
    const pathWithinWorkspace = relative(resolve(root), resolve(filePath))
    if (pathWithinWorkspace === '' || pathWithinWorkspace === '..' || pathWithinWorkspace.startsWith(`..${sep}`) || isAbsolute(pathWithinWorkspace)) {
      continue
    }
    return pathWithinWorkspace.split(sep).join('/')
  }
  return filePath
}

function resourceKey(resource: AgentSkillResource): string {
  return `${resource.filesystem}\0${resource.path}`
}

export interface SkillsRoutesOptions {
  path?: string
  authorizeRequest?: (request: FastifyRequest) => void | Promise<void>
  workspace?: Workspace
  additionalSkillPaths?: string[]
  piPackages?: PiPackageSource[]
  noSkills?: boolean
  getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
  getAdditionalSkillPaths?: (request: FastifyRequest) => string[] | undefined | Promise<string[] | undefined>
  getPiPackages?: (request: FastifyRequest) => PiPackageSource[] | undefined | Promise<PiPackageSource[] | undefined>
  getNoSkills?: (request: FastifyRequest) => boolean | undefined | Promise<boolean | undefined>
  getSkillResourceSnapshot?: (request: FastifyRequest) => AgentSkillResourceSnapshot | undefined | Promise<AgentSkillResourceSnapshot | undefined>
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
    if (!refresh && cachedEntry && cachedEntry.expiresAt > now) return cachedEntry

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
      const workspacePath = absoluteFilePath
        ? pathForWorkspaceEditor(workspace, absoluteFilePath, additionalSkillPaths ?? [])
        : undefined
      const resource = absoluteFilePath
        ? resourceSnapshot?.locateSkill(absoluteFilePath) ??
          (workspacePath && !isAbsolute(workspacePath) ? { filesystem: 'user' as const, path: workspacePath } : undefined)
        : undefined
      return {
        name: String(s.name),
        description: String(s.description ?? ''),
        ...(resource ? { resource } : {}),
        ...(typeof (s.sourceInfo as { scope?: unknown } | undefined)?.scope === 'string' ? { source: (s.sourceInfo as { scope: string }).scope } : {}),
      }
    })
    // Pinned Pi collapses duplicate frontmatter names. Preserve every admitted
    // management identity while leaving Pi's invocation winner untouched.
    const skills: SkillSummary[] = []
    const seenResources = new Set<string>()
    const managementSkills = (resourceSnapshot?.managedSkills ?? []).map((skill) => ({
      ...skill,
      invocable: skill.invocable ?? false,
    }))
    for (const skill of [...invocationSkills, ...managementSkills]) {
      if (skill.resource) {
        const key = resourceKey(skill.resource)
        if (seenResources.has(key)) continue
        seenResources.add(key)
      }
      skills.push(skill)
    }
    const entry = { skills, expiresAt: now + CACHE_TTL_MS }
    cached.set(cacheKey, entry)
    return entry
  }

  app.get<{ Querystring: SkillsQuery }>(opts.path ?? '/api/v1/agents/:agentTypeId/skills', async (request, reply) => {
    await opts.authorizeRequest?.(request)
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

  done()
}
