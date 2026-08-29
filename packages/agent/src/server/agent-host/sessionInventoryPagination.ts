import { createHash, randomUUID } from 'node:crypto'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  compareSessionOrder,
  type AgentSessionSummary,
  type SessionArchiveFilter,
  type SessionOrderTuple,
} from '../../shared/index'

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100

interface SessionInventoryCursorPosition {
  readonly updatedAt: number
  readonly agentTypeId: string
  readonly sessionId: string
}

interface SessionInventoryPageBinding {
  readonly workspaceScopeId: string
  readonly agentTypeId: string | undefined
  readonly limit: number
  readonly archived: SessionArchiveFilter
}

export interface SessionInventoryPagePlan extends SessionInventoryPageBinding {
  readonly depth: number
  readonly after: SessionInventoryCursorPosition | undefined
  readonly perAgentLimit: number
}

export interface SessionInventoryPageInput {
  readonly workspaceScopeId: string
  readonly agentTypeId?: string
  readonly limit?: number
  readonly archived: SessionArchiveFilter
  readonly cursor?: string
}

function sessionOrderTuple(summary: AgentSessionSummary): SessionOrderTuple {
  return [summary.updatedAt, summary.ref.agentTypeId, summary.ref.sessionId]
}

function compareSessions(left: AgentSessionSummary, right: AgentSessionSummary): number {
  return compareSessionOrder(sessionOrderTuple(left), sessionOrderTuple(right))
}

function isAfterCursor(summary: AgentSessionSummary, cursor: SessionInventoryCursorPosition): boolean {
  return compareSessionOrder(
    sessionOrderTuple(summary),
    [cursor.updatedAt, cursor.agentTypeId, cursor.sessionId],
  ) > 0
}

/** Owns merged session ordering, bounded page planning, and binding-scoped cursor signatures. */
export class SessionInventoryPager {
  private readonly cursorSecret = randomUUID()

  plan(input: SessionInventoryPageInput): SessionInventoryPagePlan {
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_PAGE_LIMIT)))
    const cursor = input.cursor
      ? this.decodeCursor(input.cursor, {
          workspaceScopeId: input.workspaceScopeId,
          agentTypeId: input.agentTypeId,
          limit,
          archived: input.archived,
        })
      : { depth: 0, after: undefined }
    return {
      workspaceScopeId: input.workspaceScopeId,
      agentTypeId: input.agentTypeId,
      limit,
      archived: input.archived,
      depth: cursor.depth,
      after: cursor.after,
      // The cursor boundary is pushed into every store query, so each seat only
      // needs one page plus the lookahead row used to prove continuation.
      perAgentLimit: limit + 1,
    }
  }

  page(
    plan: SessionInventoryPagePlan,
    rows: readonly AgentSessionSummary[],
  ): { sessions: AgentSessionSummary[]; nextCursor?: string } {
    const ordered = [...rows].sort(compareSessions)
    const eligible = plan.after
      ? ordered.filter((row) => isAfterCursor(row, plan.after!))
      : ordered
    const sessions = eligible.slice(0, plan.limit)
    const nextCursor = eligible.length > sessions.length && sessions.length > 0
      ? this.encodeCursor(plan, plan.depth + sessions.length, sessions.at(-1)!)
      : undefined
    return { sessions, ...(nextCursor ? { nextCursor } : {}) }
  }

  private encodeCursor(
    binding: SessionInventoryPageBinding,
    depth: number,
    last: AgentSessionSummary,
  ): string {
    const payload = JSON.stringify({
      workspaceScopeId: binding.workspaceScopeId,
      agentTypeId: binding.agentTypeId ?? null,
      limit: binding.limit,
      archived: binding.archived,
      depth,
      updatedAt: last.updatedAt,
      lastAgentTypeId: last.ref.agentTypeId,
      sessionId: last.ref.sessionId,
    })
    const encoded = Buffer.from(payload).toString('base64url')
    const signature = createHash('sha256').update(`${this.cursorSecret}:${encoded}`).digest('base64url')
    return `${encoded}.${signature}`
  }

  private decodeCursor(
    cursor: string,
    binding: SessionInventoryPageBinding,
  ): { depth: number; after: SessionInventoryCursorPosition } {
    try {
      const [encoded, signature, extra] = cursor.split('.')
      if (!encoded || !signature || extra) throw new Error('malformed')
      const expected = createHash('sha256').update(`${this.cursorSecret}:${encoded}`).digest('base64url')
      if (signature !== expected) throw new Error('signature')
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
      if (
        decoded.workspaceScopeId !== binding.workspaceScopeId
        || decoded.agentTypeId !== (binding.agentTypeId ?? null)
        || decoded.limit !== binding.limit
        || decoded.archived !== binding.archived
        || typeof decoded.depth !== 'number'
        || !Number.isInteger(decoded.depth)
        || decoded.depth < 0
        || typeof decoded.updatedAt !== 'number'
        || typeof decoded.lastAgentTypeId !== 'string'
        || typeof decoded.sessionId !== 'string'
      ) throw new Error('binding')
      return {
        depth: decoded.depth,
        after: {
          updatedAt: decoded.updatedAt,
          agentTypeId: decoded.lastAgentTypeId,
          sessionId: decoded.sessionId,
        },
      }
    } catch {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID, 'session cursor is invalid')
    }
  }
}
