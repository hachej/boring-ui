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
import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
} from '@mariozechner/pi-coding-agent'
import type { PiPackageSource } from '../../piPackages'
import { createResourceSettingsManager } from '../../harness/pi-coding-agent/createHarness'

export interface SkillSummary {
  name: string
  description: string
}

interface SkillsQuery {
  refresh?: string
}

const CACHE_TTL_MS = 30_000

export interface SkillsRoutesOptions {
  workspaceRoot: string
  additionalSkillPaths?: string[]
  piPackages?: PiPackageSource[]
  noSkills?: boolean
  getWorkspaceRoot?: (request: FastifyRequest) => string | Promise<string>
  getAdditionalSkillPaths?: (request: FastifyRequest) => string[] | undefined | Promise<string[] | undefined>
  getPiPackages?: (request: FastifyRequest) => PiPackageSource[] | undefined | Promise<PiPackageSource[] | undefined>
  getNoSkills?: (request: FastifyRequest) => boolean | undefined | Promise<boolean | undefined>
}

export function skillsRoutes(
  app: FastifyInstance,
  opts: SkillsRoutesOptions,
  done: (err?: Error) => void,
): void {
  const cached = new Map<string, { skills: SkillSummary[]; expiresAt: number }>()

  app.get<{ Querystring: SkillsQuery }>('/api/v1/agent/skills', async (request, reply) => {
    try {
      const workspaceRoot = opts.getWorkspaceRoot
        ? await opts.getWorkspaceRoot(request)
        : opts.workspaceRoot
      const additionalSkillPaths = opts.getAdditionalSkillPaths
        ? await opts.getAdditionalSkillPaths(request)
        : opts.additionalSkillPaths
      const piPackages = opts.getPiPackages
        ? await opts.getPiPackages(request)
        : opts.piPackages
      const noSkills = opts.getNoSkills
        ? await opts.getNoSkills(request)
        : opts.noSkills
      const cacheKey = JSON.stringify([workspaceRoot, additionalSkillPaths ?? [], piPackages ?? [], Boolean(noSkills)])
      const now = Date.now()
      for (const [key, entry] of cached) {
        if (entry.expiresAt <= now) cached.delete(key)
      }
      const cachedEntry = cached.get(cacheKey)
      const refresh = request.query.refresh === '1'
      if (!refresh && cachedEntry && cachedEntry.expiresAt > now) {
        return reply.code(200).send({ skills: cachedEntry.skills })
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
        includeDefaults: false,
      })
      const skills: SkillSummary[] = result.skills.map((s) => ({
        name: s.name,
        description: s.description,
      }))
      cached.set(cacheKey, { skills, expiresAt: now + CACHE_TTL_MS })
      return reply.code(200).send({ skills })
    } catch {
      return reply.code(200).send({ skills: [] })
    }
  })

  done()
}
