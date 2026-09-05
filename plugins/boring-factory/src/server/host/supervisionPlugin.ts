import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { defineServerPlugin } from '@hachej/boring-workspace/server'
import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import type { FactoryEpicRegistry } from './epicRegistry'
import { FactoryEpicResolutionError, resolveFactoryEpic, type FactorySessionBindings } from './sessionBindings'

export const FACTORY_SUPERVISION_PLUGIN_ID = 'factory-supervision'

/** Bump when this file's supervision behavior changes; hashed into the plugin's contentDigest. */
const SUPERVISION_PLUGIN_VERSION = 'factory-supervision.v1.2026-09-03'

/** The only seat this plugin ever supervises: an Orchestrator may only supervise itself. */
const SUPERVISED_AGENT_TYPE_ID = 'boring-orchestrator'


export const SUPERVISION_MIN_INTERVAL_MS = 30_000
export const SUPERVISION_MAX_INTERVAL_MS = 3_600_000
export const SUPERVISION_DEFAULT_INTERVAL_MS = 120_000

const DEFAULT_PROMPT =
  'Run factory_status and check the epic\'s durable end-state facts (Bead status/assignee, ' +
  'commits on the epic branch, Bead comments, sandbox releases, fresh_review provenance) ' +
  'against the epic\'s acceptance criteria; recover any stale claim per the Recovery rule. ' +
  'Report durable end-state facts only; never implement.'

export interface SupervisionEntry {
  readonly epicKey: string
  readonly agentTypeId: string
  readonly sessionId: string
  readonly intervalMs: number
  readonly prompt: string
  readonly startedAt: string
  readonly lastTickAt?: string
  readonly lastTickOutcome?: 'sent' | 'skipped-busy' | 'error'
  readonly ticks: number
}

interface SupervisionState {
  readonly entries: Record<string, SupervisionEntry>
}

export interface CreateFactorySupervisionPluginOptions {
  /** Directory holding `supervision.json`. Created if missing. */
  readonly stateRoot: string
  /** Host-owned workspace identity used on every in-process `app.inject` call. */
  readonly workspaceScopeId: string
  readonly registry: FactoryEpicRegistry
  readonly sessionBindings: FactorySessionBindings
  /** Default nudge interval for `start` calls that omit `intervalMs`. */
  readonly defaultIntervalMs?: number
}

export interface FactorySupervisionPluginControl {
  stopSupervision(sessionId: string, app: FastifyInstance, workspaceScopeId: string): Promise<void>
}

export interface FactorySupervisionPluginHandle {
  readonly plugin: ReturnType<typeof defineServerPlugin>
  /** Wire the live fastify app once `createWorkspaceAgentServer` resolves, and register the onClose hook. */
  bind(app: FastifyInstance): void
  /** Read the state file and arm a timer for every persisted entry. Returns the count armed. */
  rearm(): Promise<number>
  /** Host-only control surface for epic closure. */
  readonly control: FactorySupervisionPluginControl
  /** Clear every armed timer. Idempotent. */
  close(): void
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function jsonResult(details: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError }
}

function invalidInputResult(message: string): ToolResult {
  return jsonResult({ code: 'INVALID_INPUT', message }, true)
}

function epicResolutionResult(error: unknown): ToolResult {
  if (error instanceof FactoryEpicResolutionError) return jsonResult({ code: error.code, message: error.message }, true)
  return jsonResult({ code: 'EPIC_RESOLUTION_FAILED', message: error instanceof Error ? error.message : 'failed to resolve Factory epic' }, true)
}

function modelSelection(encoded: string | undefined): { provider: string; id: string } | undefined {
  const separator = encoded?.indexOf(':') ?? -1
  if (!encoded || separator <= 0 || separator === encoded.length - 1) return undefined
  return { provider: encoded.slice(0, separator), id: encoded.slice(separator + 1) }
}

async function readState(statePath: string): Promise<SupervisionState> {
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SupervisionState>
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return { entries: { ...parsed.entries } }
    }
  } catch {
    // Missing or corrupt state file: start from an empty supervision table.
  }
  return { entries: {} }
}

async function writeStateAtomic(statePath: string, state: SupervisionState): Promise<void> {
  const tmpPath = `${statePath}.tmp-${randomUUID()}`
  await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmpPath, statePath)
}

interface SupervisedSessionState {
  readonly state?: { readonly status?: string }
}

export function createFactorySupervisionPlugin(
  options: CreateFactorySupervisionPluginOptions,
): FactorySupervisionPluginHandle {
  if (!options.stateRoot.trim()) throw new TypeError('factory-supervision stateRoot is required')
  const stateRoot = options.stateRoot
  const workspaceScopeId = options.workspaceScopeId
  const statePath = resolve(stateRoot, 'supervision.json')
  const defaultIntervalMs = options.defaultIntervalMs ?? SUPERVISION_DEFAULT_INTERVAL_MS

  let boundApp: FastifyInstance | undefined
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  let stateMutations = Promise.resolve()

  function clearTimerFor(sessionId: string): void {
    const timer = timers.get(sessionId)
    if (timer) {
      clearInterval(timer)
      timers.delete(sessionId)
    }
  }

  async function mutateState(mutator: (current: SupervisionState) => SupervisionState): Promise<SupervisionState> {
    let next!: SupervisionState
    const operation = stateMutations.then(async () => {
      await mkdir(stateRoot, { recursive: true })
      const current = await readState(statePath)
      next = mutator(current)
      await writeStateAtomic(statePath, next)
    })
    stateMutations = operation.catch(() => undefined)
    await operation
    return next
  }

  async function tick(sessionId: string): Promise<void> {
    const app = boundApp
    if (!app) return
    const beforeTick = await readState(statePath)
    const entry = beforeTick.entries[sessionId]
    if (!entry) {
      clearTimerFor(sessionId)
      return
    }

    let outcome: NonNullable<SupervisionEntry['lastTickOutcome']>
    try {
      const stateResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/agents/${entry.agentTypeId}/sessions/${entry.sessionId}/state`,
        headers: { 'x-boring-workspace-id': workspaceScopeId },
      })
      if (stateResponse.statusCode !== 200) {
        outcome = 'error'
      } else {
        const body = stateResponse.json<SupervisedSessionState>()
        if (body.state?.status !== 'idle') {
          outcome = 'skipped-busy'
        } else {
          const tickNumber = entry.ticks + 1
          const epic = await options.registry.get(entry.epicKey)
          if (!epic || epic.status !== 'active') {
            clearTimerFor(sessionId)
            return
          }
          const selectedModel = modelSelection(epic.models?.orchestrator)
          const promptResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/agents/${entry.agentTypeId}/sessions/${entry.sessionId}/prompt`,
            headers: { 'x-boring-workspace-id': workspaceScopeId },
            payload: {
              requestId: randomUUID(),
              clientNonce: randomUUID(),
              content: `Supervision tick ${tickNumber} (${new Date().toISOString()}): ${entry.prompt}`,
              requireIdle: true,
              ...(selectedModel ? { model: selectedModel } : {}),
            },
          })
          outcome = promptResponse.statusCode === 202 ? 'sent' : 'error'
        }
      }
    } catch {
      outcome = 'error'
    }

    await mutateState((current) => {
      const currentEntry = current.entries[sessionId]
      if (!currentEntry) return current
      const ticks = outcome === 'sent' ? currentEntry.ticks + 1 : currentEntry.ticks
      return {
        entries: {
          ...current.entries,
          [sessionId]: {
            ...currentEntry,
            lastTickAt: new Date().toISOString(),
            lastTickOutcome: outcome,
            ticks,
          },
        },
      }
    })
  }

  function arm(sessionId: string, intervalMs: number): void {
    clearTimerFor(sessionId)
    const timer = setInterval(() => {
      tick(sessionId).catch(() => {
        // Errors are recorded on the entry by tick() itself; never let a rejected tick crash the timer loop.
      })
    }, intervalMs)
    timer.unref?.()
    timers.set(sessionId, timer)
  }

  async function rearm(): Promise<number> {
    const state = await readState(statePath)
    const activeKeys = new Set((await options.registry.list()).filter((entry) => entry.status === 'active').map((entry) => entry.epicKey))
    let count = 0
    for (const entry of Object.values(state.entries)) {
      if (!entry.epicKey || !activeKeys.has(entry.epicKey)) continue
      arm(entry.sessionId, entry.intervalMs)
      count += 1
    }
    return count
  }

  function close(): void {
    for (const sessionId of [...timers.keys()]) clearTimerFor(sessionId)
  }

  function parseOp(value: unknown): 'start' | 'stop' | 'status' | undefined {
    return value === 'start' || value === 'stop' || value === 'status' ? value : undefined
  }

  function parseIntervalMs(value: unknown): number | { error: string } {
    if (value === undefined) return defaultIntervalMs
    if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'intervalMs must be a number' }
    if (value < SUPERVISION_MIN_INTERVAL_MS || value > SUPERVISION_MAX_INTERVAL_MS) {
      return { error: `intervalMs must be between ${SUPERVISION_MIN_INTERVAL_MS} and ${SUPERVISION_MAX_INTERVAL_MS}` }
    }
    return value
  }

  function parsePrompt(value: unknown): string | { error: string } {
    if (value === undefined) return DEFAULT_PROMPT
    if (typeof value !== 'string' || value.trim().length === 0) return { error: 'prompt must be a non-empty string when provided' }
    return value
  }

  const superviseTool: AgentTool = {
    name: 'supervise',
    description:
      'Start, stop, or check a durable host-armed nudge that periodically re-prompts your own session ' +
      'with a supervision instruction while you are idle (a tick is skipped, never queued, while you are ' +
      'busy). The nudge is persisted to disk and automatically re-armed after a host restart, replacing ' +
      'the old in-memory /loop timers. You can only supervise your own session.',
    parameters: {
      type: 'object',
      properties: {
        epicKey: {
          type: 'string',
          description: 'Optional explicit epic override. Normally the host resolves the epic from this session binding.',
        },
        op: {
          type: 'string',
          enum: ['start', 'stop', 'status'],
          description: '"start" arms (or re-arms) the nudge on your session; "stop" disarms and forgets it; "status" reports the current entry.',
        },
        intervalMs: {
          type: 'number',
          minimum: SUPERVISION_MIN_INTERVAL_MS,
          maximum: SUPERVISION_MAX_INTERVAL_MS,
          description: `Only used with op="start". Milliseconds between ticks (min ${SUPERVISION_MIN_INTERVAL_MS}, max ${SUPERVISION_MAX_INTERVAL_MS}, default ${SUPERVISION_DEFAULT_INTERVAL_MS} unless the host set another default).`,
        },
        prompt: {
          type: 'string',
          description: 'Only used with op="start". The nudge text sent on each tick. Defaults to a durable end-state supervision instruction that names epic end-state checks and says "report durable end-state facts only; never implement".',
        },
      },
      required: ['op'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const op = parseOp(params.op)
      if (!op) return invalidInputResult('op must be one of "start", "stop", "status"')
      const sessionId = ctx.sessionId
      if (!sessionId) return invalidInputResult('supervise requires a known session id')
      let epic
      try {
        epic = await resolveFactoryEpic(params, ctx, options.registry, options.sessionBindings)
      } catch (error) {
        return epicResolutionResult(error)
      }

      if (op === 'status') {
        const state = await readState(statePath)
        const entry = state.entries[sessionId]
        return jsonResult(entry?.epicKey === epic.epicKey ? entry : null)
      }

      if (op === 'stop') {
        clearTimerFor(sessionId)
        const next = await mutateState((current) => {
          if (!(sessionId in current.entries)) return current
          const rest = { ...current.entries }
          delete rest[sessionId]
          return { entries: rest }
        })
        return jsonResult(next.entries[sessionId] ?? null)
      }

      const intervalMs = parseIntervalMs(params.intervalMs)
      if (typeof intervalMs === 'object') return invalidInputResult(intervalMs.error)
      const prompt = parsePrompt(params.prompt)
      if (typeof prompt === 'object') return invalidInputResult(prompt.error)

      const next = await mutateState((current) => {
        const existing = current.entries[sessionId]
        const entry: SupervisionEntry = {
          epicKey: epic.epicKey,
          agentTypeId: SUPERVISED_AGENT_TYPE_ID,
          sessionId,
          intervalMs,
          prompt,
          startedAt: existing?.startedAt ?? new Date().toISOString(),
          ...(existing?.lastTickAt !== undefined ? { lastTickAt: existing.lastTickAt } : {}),
          ...(existing?.lastTickOutcome !== undefined ? { lastTickOutcome: existing.lastTickOutcome } : {}),
          ticks: existing?.ticks ?? 0,
        }
        return { entries: { ...current.entries, [sessionId]: entry } }
      })
      arm(sessionId, intervalMs)
      return jsonResult(next.entries[sessionId] ?? null)
    },
  }

  const plugin = defineServerPlugin({
    id: FACTORY_SUPERVISION_PLUGIN_ID,
    label: 'Factory supervision',
    contentDigest: sha256(SUPERVISION_PLUGIN_VERSION),
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }) {
      if (agentTypeId !== SUPERVISED_AGENT_TYPE_ID) return []
      return [superviseTool]
    },
  })

  // In-process stop: the same path the `supervise` tool's "stop" op takes. No HTTP hop, no route literal.
  async function stopSupervision(sessionId: string, _app: FastifyInstance, _workspaceScopeId: string): Promise<void> {
    clearTimerFor(sessionId)
    await mutateState((current) => {
      if (!(sessionId in current.entries)) return current
      const rest = { ...current.entries }
      delete rest[sessionId]
      return { entries: rest }
    })
  }

  return {
    plugin,
    bind(app: FastifyInstance) {
      boundApp = app
      app.addHook('onClose', async () => {
        close()
      })
    },
    rearm,
    control: { stopSupervision },
    close,
  }
}
