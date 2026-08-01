import type { FastifyInstance } from 'fastify'

const EXPECTED_ROUTES_ENV = 'BORING_AGENTHOST_EXPECTED_ROUTES'
const FALLBACK_EXPECTED_ROUTES = [
  'GET /api/v1/agents',
  'GET /api/v1/agents/:agentTypeId/sessions',
  'POST /api/v1/agents/:agentTypeId/sessions',
  'DELETE /api/v1/agents/:agentTypeId/sessions/:sessionId',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/state',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/events',
  'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/rename',
  'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/prompt',
  'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/followup',
  'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/queue/clear',
  'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/interrupt',
  'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/stop',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index',
  'POST /api/v1/agents/:agentTypeId/reload',
  'GET /api/v1/agents/:agentTypeId/skills',
  'GET /api/v1/agents/:agentTypeId/commands',
  'POST /api/v1/agents/:agentTypeId/commands/execute',
  'GET /api/v1/agents/:agentTypeId/models',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/system-prompt',
  'GET /api/v1/agents/:agentTypeId/tools',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/changes',
  'GET /api/v1/agents/:agentTypeId/ready-status',
] as const

interface ExpectedRouteContract {
  readonly required: readonly string[]
  readonly allowed: readonly string[]
}

function configuredContract(): ExpectedRouteContract {
  const encoded = process.env[EXPECTED_ROUTES_ENV]
  if (!encoded) return { required: FALLBACK_EXPECTED_ROUTES, allowed: [] }
  const parsed = JSON.parse(encoded) as ExpectedRouteContract
  if (!Array.isArray(parsed.required) || !Array.isArray(parsed.allowed)) {
    throw new Error('invalid Agent Host route proof contract')
  }
  return parsed
}

function composedAgentRoutes(app: FastifyInstance): Map<string, number> {
  const routes = new Map<string, number>()
  const parentPaths: string[] = []
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = line.match(/^((?:│   |    )*)[├└]── (\/\S+) \(([^)]+)\)$/)
    if (!match) continue
    const depth = match[1]!.length / 4
    const path = depth === 0 ? match[2]! : `${parentPaths[depth - 1]}${match[2]!}`
    parentPaths[depth] = path
    parentPaths.length = depth + 1
    const agentBase = '/api/v1/' + 'agent'
    if (!(path.startsWith(`${agentBase}/`) || path === `${agentBase}s` || path.startsWith(`${agentBase}s/`))) continue
    for (const method of match[3]!.split(',').map((value) => value.trim())) {
      if (method === 'HEAD') continue
      const contract = `${method} ${path}`
      routes.set(contract, (routes.get(contract) ?? 0) + 1)
    }
  }
  return routes
}

/** Executable Slice 1 proof shared by every composition root. */
export function assertComposedAgentHostRouteTable(
  app: FastifyInstance,
  options: { readonly testOnlyAllowed?: readonly string[] } = {},
): void {
  const expected = configuredContract()
  if (expected.required.length === 0) throw new Error('expected Agent Host route table is empty')
  const observed = composedAgentRoutes(app)
  const allowed = new Set([...expected.allowed, ...(options.testOnlyAllowed ?? [])])
  for (const contract of expected.required) {
    const count = observed.get(contract) ?? 0
    if (count !== 1) throw new Error(
      `composed Agent Host route multiplicity is ${count}, expected 1: ${contract}\n${app.printRoutes({ commonPrefix: false })}`,
    )
  }
  for (const [contract, count] of observed) {
    if (expected.allowed.length > 0 && !allowed.has(contract)) {
      throw new Error(`unclassified Agent route is composed: ${contract}`)
    }
    if (count !== 1) throw new Error(`duplicate Agent route is composed (${count}): ${contract}`)
  }
}
