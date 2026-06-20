/**
 * GET /api/v1/agent/skills
 *
 * Returns the list of PI skills discovered for the current workspace —
 * global skills (~/.pi/agent/skills) plus any project-local SKILL.md files.
 * The front-end uses this to populate the slash-command picker without
 * host apps having to hardcode skill names in extraCommands.
 *
 * Shape:
 *   { skills: [{ name: string, description: string, filePath?: string }] }
 *
 * `filePath` is the path to the skill's SKILL.md exposed for the workspace UI
 * bridge. It is workspace-relative when the skill lives under the workspace
 * root (so `openFile` can load it), and falls back to the absolute path for
 * external skill sources.
 */
import { isAbsolute, relative } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
} from '@mariozechner/pi-coding-agent'
import type { PiPackageSource } from '../../piPackages'
import { createResourceSettingsManager, withPiHarnessDefaults } from '../../harness/pi-coding-agent/createHarness'

export interface SkillSummary {
  name: string
  description: string
  /** Path to the skill's SKILL.md for UI bridge openFile (workspace-relative when possible). */
  filePath?: string
}

interface SkillsQuery {
  refresh?: string
}

function skillPathForUiBridge(workspaceRoot: string, filePath: string): string {
  const rel = relative(workspaceRoot, filePath).replace(/\\/g, '/')
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel
  return filePath
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
        includeDefaults: !noSkills,
      })
      const skills: SkillSummary[] = result.skills.map((s) => ({
        name: s.name,
        description: s.description,
        filePath: skillPathForUiBridge(workspaceRoot, s.filePath),
      }))
      cached.set(cacheKey, { skills, expiresAt: now + CACHE_TTL_MS })
      return reply.code(200).send({ skills })
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
