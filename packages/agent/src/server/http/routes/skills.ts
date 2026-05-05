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
import type { FastifyInstance } from 'fastify'
import { loadSkills } from '@mariozechner/pi-coding-agent'

export interface SkillSummary {
  name: string
  description: string
}

const CACHE_TTL_MS = 30_000

export function skillsRoutes(
  app: FastifyInstance,
  opts: { workspaceRoot: string },
  done: (err?: Error) => void,
): void {
  let cached: { skills: SkillSummary[]; expiresAt: number } | null = null

  app.get('/api/v1/agent/skills', (_request, reply) => {
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      return reply.code(200).send({ skills: cached.skills })
    }

    try {
      const result = loadSkills({ cwd: opts.workspaceRoot, includeDefaults: true })
      const skills: SkillSummary[] = result.skills.map((s) => ({
        name: s.name,
        description: s.description,
      }))
      cached = { skills, expiresAt: now + CACHE_TTL_MS }
      return reply.code(200).send({ skills })
    } catch {
      return reply.code(200).send({ skills: [] })
    }
  })

  done()
}
