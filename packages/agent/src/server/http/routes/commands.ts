import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AgentHarness, AgentSlashCommandSummary, RunContext } from '../../../shared/harness'
import type { AgentMeteringSink } from '../../pi-chat/metering'
import { AgentEffectAdmissionError, type AgentEffectAdmission } from '../../../core/piChatSessionService'
import { ErrorCode, type ErrorCode as ErrorCodeValue } from '../../../shared/error-codes'
import { resolveRequestPrincipal } from '../requestPrincipal'

const DEFAULT_WORKSPACE_ID = 'default'

type CommandsRoutesBaseOptions = {
  defaultSessionId: string
  admitEffect?: AgentEffectAdmission
  metering?: Pick<AgentMeteringSink, 'isEnabled'>
}

export type CommandsRoutesOptions = CommandsRoutesBaseOptions & ({
  harness: AgentHarness
  workdir: string
} | {
  getHarness: (request: FastifyRequest) => AgentHarness | Promise<AgentHarness>
  getWorkdir: (request: FastifyRequest) => string | Promise<string>
})

function normalizeSessionId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function resolveHarness(opts: CommandsRoutesOptions, request: FastifyRequest): AgentHarness | Promise<AgentHarness> {
  return 'getHarness' in opts ? opts.getHarness(request) : opts.harness
}

function resolveWorkdir(opts: CommandsRoutesOptions, request: FastifyRequest): string | Promise<string> {
  return 'getWorkdir' in opts ? opts.getWorkdir(request) : opts.workdir
}

function getRequestWorkspaceId(request: FastifyRequest): string {
  return request.workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID
}

function isErrorCode(value: unknown): value is ErrorCodeValue {
  return typeof value === 'string' && ErrorCode.options.includes(value as ErrorCodeValue)
}

function errorStatusCode(error: unknown): number {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500
}

function isMeteringActive(metering: Pick<AgentMeteringSink, 'isEnabled'> | undefined): boolean {
  if (!metering) return false
  return metering.isEnabled ? metering.isEnabled() === true : true
}

function buildRunContext(request: FastifyRequest, workdir: string, options: { allowPromptDispatch?: boolean } = {}): RunContext {
  const principal = resolveRequestPrincipal(request)
  return {
    abortSignal: new AbortController().signal,
    workdir,
    workspaceId: getRequestWorkspaceId(request),
    requestId: request.id,
    userId: principal.authSubject,
    userEmail: principal.authEmail,
    userEmailVerified: principal.authEmailVerified === true,
    ...(options.allowPromptDispatch === false ? { allowPromptDispatch: false } : {}),
  }
}

function meteredCommandBlocked(command: string) {
  return {
    error: {
      code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND,
      message: 'Slash command execution is disabled while metering is configured.',
      details: { command },
    },
  }
}

function stableErrorPayload(error: unknown, message: string) {
  const code = (error as { code?: unknown } | null)?.code
  if (!isErrorCode(code) && !(error instanceof AgentEffectAdmissionError)) return undefined
  const details = (error as { details?: unknown } | null)?.details
  return {
    error: {
      code,
      message,
      ...(details && typeof details === 'object' ? { details } : {}),
    },
  }
}

export function commandsRoutes(
  app: FastifyInstance,
  opts: CommandsRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/agent/commands', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>
      const sessionId = normalizeSessionId(query.sessionId, opts.defaultSessionId)
      const [harness, workdir] = await Promise.all([
        resolveHarness(opts, request),
        resolveWorkdir(opts, request),
      ])
      const commands: ReadonlyArray<AgentSlashCommandSummary> = await harness.getSlashCommands?.(sessionId, buildRunContext(request, workdir)) ?? []
      return reply.code(200).send({ commands })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ commands: [], error: message })
    }
  })

  app.post('/api/v1/agent/commands/execute', async (request, reply) => {
    try {
      const [harness, workdir] = await Promise.all([
        resolveHarness(opts, request),
        resolveWorkdir(opts, request),
      ])
      if (!harness.executeSlashCommand) {
        return reply.code(501).send({ error: 'Command execution not supported by this harness.' })
      }
      const query = request.query as Record<string, unknown>
      const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {}
      const sessionId = normalizeSessionId(query.sessionId, opts.defaultSessionId)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const args = typeof body.args === 'string' ? body.args : ''
      if (!name) return reply.code(400).send({ error: 'name body field is required' })
      const meteringActive = isMeteringActive(opts.metering)
      const runContext = buildRunContext(request, workdir, {
        ...(meteringActive ? { allowPromptDispatch: false } : {}),
      })
      if (meteringActive) {
        // Extension handlers can call captured Pi APIs that trigger turns; until command execution is metered, fail closed.
        return reply.code(409).send(meteredCommandBlocked(name))
      }
      await opts.admitEffect?.({ workspaceId: getRequestWorkspaceId(request), requestId: request.id })
      await harness.executeSlashCommand(sessionId, name, args, runContext)
      return reply.code(200).send({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stable = stableErrorPayload(error, message)
      if (stable) return reply.code(errorStatusCode(error)).send(stable)
      return reply.code(500).send({ error: message })
    }
  })

  done()
}
