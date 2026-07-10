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
} from '@mariozechner/pi-coding-agent'
import type { PiPackageSource } from '../../piPackages'
import { createResourceSettingsManager, withPiHarnessDefaults } from '../../harness/pi-coding-agent/createHarness'
import { isReadonlySkillFilePath, type ReadonlySkillFileRegistry } from '../readonlySkillFiles'

export interface SkillSummary {
  name: string
  description: string
  /** Absolute path to the resolved SKILL.md, used by workspace UIs to open it. */
  filePath?: string
  /** Human-readable source/scope label for diagnostics and disabled rows. */
  source?: string
}

interface SkillsQuery {
  refresh?: string
}

const CACHE_TTL_MS = 30_000

function skillFilePathForWorkspace(filePath: string, workspaceRoot: string): string {
  if (!isAbsolute(filePath)) return filePath
  const workspaceRelative = relative(resolve(workspaceRoot), resolve(filePath))
  if (
    workspaceRelative === ''
    || workspaceRelative === '..'
    || workspaceRelative.startsWith(`..${sep}`)
    || isAbsolute(workspaceRelative)
  ) {
    return filePath
  }
  return workspaceRelative.split(sep).join('/')
}

export interface SkillsRoutesOptions {
  workspaceRoot: string
  additionalSkillPaths?: string[]
  piPackages?: PiPackageSource[]
  noSkills?: boolean
  getWorkspaceRoot?: (request: FastifyRequest) => string | Promise<string>
  getAdditionalSkillPaths?: (request: FastifyRequest) => string[] | undefined | Promise<string[] | undefined>
  getPiPackages?: (request: FastifyRequest) => PiPackageSource[] | undefined | Promise<PiPackageSource[] | undefined>
  getNoSkills?: (request: FastifyRequest) => boolean | undefined | Promise<boolean | undefined>
  readonlySkillFiles?: ReadonlySkillFileRegistry
  getReadonlySkillScope?: (request: FastifyRequest) => string | Promise<string>
}

export function skillsRoutes(
  app: FastifyInstance,
  opts: SkillsRoutesOptions,
  done: (err?: Error) => void,
): void {
  const cached = new Map<string, { skills: SkillSummary[]; expiresAt: number }>()

  async function registerReadonlySkillFiles(request: FastifyRequest, skills: readonly SkillSummary[]): Promise<void> {
    if (!opts.readonlySkillFiles) return
    const scope = opts.getReadonlySkillScope ? await opts.getReadonlySkillScope(request) : 'default'
    opts.readonlySkillFiles.replace(
      scope,
      skills.flatMap((skill) => (
        skill.filePath && isReadonlySkillFilePath(skill.filePath) ? [skill.filePath] : []
      )),
    )
  }

  async function resolveSkillsForRequest(request: FastifyRequest, refresh = false) {
    const workspaceRoot = opts.getWorkspaceRoot
      ? await opts.getWorkspaceRoot(request)
      : opts.workspaceRoot
    const additionalSkillPaths = opts.getAdditionalSkillPaths
      ? await opts.getAdditionalSkillPaths(request)
      : opts.additionalSkillPaths
    const piPackages = opts.getPiPackages
      ? await opts.getPiPackages(request)
      : opts.piPackages
    // `undefined` means the host didn't say — resolve through the canonical
    // harness policy so a bare registration can't silently flip ambient
    // skill discovery on.
    const noSkills = (opts.getNoSkills
      ? await opts.getNoSkills(request)
      : opts.noSkills) ?? withPiHarnessDefaults().noSkills
    const cacheKey = JSON.stringify([workspaceRoot, additionalSkillPaths ?? [], piPackages ?? [], noSkills])
    const now = Date.now()
    for (const [key, entry] of cached) {
      if (entry.expiresAt <= now) cached.delete(key)
    }
    const cachedEntry = cached.get(cacheKey)
    if (!refresh && cachedEntry && cachedEntry.expiresAt > now) {
      await registerReadonlySkillFiles(request, cachedEntry.skills)
      return cachedEntry
    }

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
    const skills: SkillSummary[] = (result.skills as unknown as Array<Record<string, unknown>>).map((s) => ({
      name: String(s.name),
      description: String(s.description ?? ''),
      ...(typeof s.filePath === 'string' ? { filePath: skillFilePathForWorkspace(s.filePath, workspaceRoot) } : {}),
      ...(typeof (s.sourceInfo as { scope?: unknown } | undefined)?.scope === 'string' ? { source: (s.sourceInfo as { scope: string }).scope } : {}),
    }))
    const entry = { skills, expiresAt: now + CACHE_TTL_MS }
    cached.set(cacheKey, entry)
    await registerReadonlySkillFiles(request, skills)
    return entry
  }

  app.get<{ Querystring: SkillsQuery }>('/api/v1/agent/skills', async (request, reply) => {
    try {
      const entry = await resolveSkillsForRequest(request, request.query.refresh === '1')
      return reply.code(200).send({ skills: entry.skills })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      request.log.warn({ err: error }, '[agent] failed to load skills')
      // Still 200 so the slash-command picker keeps working; the `error`
      // field makes the failure observable to callers that inspect it.
      return reply.code(200).send({ skills: [], error: message })
    }
  })

  done()
}
