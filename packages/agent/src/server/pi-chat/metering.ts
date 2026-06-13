import type { ChatModelSelection, PiChatEvent } from '../../shared/chat'
import { createLogger } from '../logging'

/**
 * Generic metering seam for hosts that bill native Pi usage.
 *
 * The agent package owns lifecycle correctness (when to reserve, record,
 * settle, release based on native Pi events); the host-provided sink owns
 * persistence and product policy (credits, pricing, currencies, hard stops).
 *
 * Lifecycle per accepted prompt/follow-up ("run", identified by `turnId`):
 *
 *   reserveRun        before execution starts; throwing rejects the request
 *                     (fail closed) so hosts can enforce hard stops.
 *   recordUsage       once per native assistant `message_end` carrying usage.
 *                     `usageId` is a stable idempotency key.
 *   settleRun         when the run reaches a native terminal state and usage
 *                     was recorded (or it finished ok).
 *   releaseRun        when the run never produced billable usage: rejected
 *                     execution, cleared queue, cancel/abort, or error before
 *                     any usage arrived.
 *
 * Every run terminates with exactly one settle or release from the
 * coordinator; sinks should still treat all four methods as idempotent
 * because process restarts can replay terminal transitions.
 */
export interface AgentMeteringSink {
  reserveRun(input: MeteringReserveInput): Promise<MeteringReservationResult | void>
  recordUsage(input: MeteringUsageInput): Promise<void>
  settleRun(input: MeteringSettleInput): Promise<void>
  releaseRun(input: MeteringReleaseInput): Promise<void>
}

export interface MeteringRunScope {
  workspaceId: string
  userId?: string
  sessionId: string
  /** Stable id for one accepted prompt/follow-up run. */
  turnId: string
  source: 'pi-chat'
}

export type MeteringRunKind = 'prompt' | 'followup'

export interface MeteringReserveInput extends MeteringRunScope {
  kind: MeteringRunKind
  message: string
  model?: ChatModelSelection
}

export interface MeteringReservationResult {
  reservationId?: string
}

export interface MeteringUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export interface MeteringUsageInput extends MeteringRunScope {
  reservationId?: string
  /** Stable idempotency key for this usage row. */
  usageId: string
  messageId?: string
  model?: { provider?: string; id?: string }
  usage: MeteringUsage
  stopReason?: string
}

export type MeteringRunStatus = 'ok' | 'error' | 'aborted'

export interface MeteringSettleInput extends MeteringRunScope {
  reservationId?: string
  status: MeteringRunStatus
}

export type MeteringReleaseReason =
  | 'run-rejected'
  | 'queue-cleared'
  | 'cancelled'
  | 'error-before-usage'

export interface MeteringReleaseInput extends MeteringRunScope {
  reservationId?: string
  reason: MeteringReleaseReason
}

export type MeteringErrorLogger = (message: string, error: unknown) => void

const meteringLogger = createLogger('pi-chat-metering')

const defaultMeteringErrorLogger: MeteringErrorLogger = (message, error) => {
  meteringLogger.warn(message, { error })
}

interface MeteringRun {
  scope: MeteringRunScope
  kind: MeteringRunKind
  reservationId?: string
  usageCount: number
  terminal: boolean
  /** Serializes sink calls per run so settle/release never overtakes usage. */
  ops: Promise<void>
}

interface SessionMeteringState {
  /** Reserved prompt run waiting for its agent-start. */
  pendingPrompt?: MeteringRun
  /** Run currently attributed native usage. */
  active?: MeteringRun
  /** Reserved follow-up runs awaiting consumption, keyed by nonce/seq. */
  queued: Map<string, MeteringRun>
}

function followUpKey(selector: { clientNonce?: string; clientSeq?: number }): string | undefined {
  if (selector.clientNonce) return `nonce:${selector.clientNonce}`
  if (selector.clientSeq !== undefined) return `seq:${selector.clientSeq}`
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Native Pi usage objects always carry token + cost breakdowns; normalize
 * defensively so a partial object from an unexpected provider still meters
 * as zeros instead of NaN. */
export function normalizeMeteringUsage(value: unknown): MeteringUsage | undefined {
  if (!isRecord(value)) return undefined
  const cost = isRecord(value.cost) ? value.cost : {}
  return {
    input: readNumber(value.input),
    output: readNumber(value.output),
    cacheRead: readNumber(value.cacheRead),
    cacheWrite: readNumber(value.cacheWrite),
    cost: {
      input: readNumber(cost.input),
      output: readNumber(cost.output),
      cacheRead: readNumber(cost.cacheRead),
      cacheWrite: readNumber(cost.cacheWrite),
      total: readNumber(cost.total),
    },
  }
}

export interface ReservePromptInput {
  workspaceId: string
  userId?: string
  sessionId: string
  clientNonce: string
  message: string
  model?: ChatModelSelection
}

export interface ReserveFollowUpInput extends ReservePromptInput {
  clientSeq: number
}

/**
 * Correlates host billing reservations with the native Pi event stream.
 *
 * One coordinator instance lives inside a HarnessPiChatService. The service
 * calls the reserve/release entry points from its request handlers and feeds
 * every native adapter event (plus its mapped PiChatEvents) into observe().
 *
 * Correlation model: an accepted prompt becomes the active run at the next
 * `agent-start`; queued follow-ups become active when their
 * `followup-consumed` event arrives (settling the previous active run, which
 * is how each user input is metered independently even though Pi runs them
 * inside one agent loop). Native assistant `message_end` events carry the
 * authoritative usage and are attributed to the active run.
 */
export class PiChatMeteringCoordinator {
  private readonly sessions = new Map<string, SessionMeteringState>()
  private readonly inflightOps = new Set<Promise<void>>()
  private readonly sink: AgentMeteringSink
  private readonly logError: MeteringErrorLogger

  constructor(sink: AgentMeteringSink, logError?: MeteringErrorLogger) {
    this.sink = sink
    this.logError = logError ?? defaultMeteringErrorLogger
  }

  /** Reserve a prompt run. Throws (fail closed) when the sink rejects. */
  async reservePrompt(input: ReservePromptInput): Promise<void> {
    const state = this.sessionState(input.sessionId)
    const run = await this.reserve(input, 'prompt', `pi-run:${input.sessionId}:prompt:${input.clientNonce}`)
    // A prompt that never reached agent-start (rejected execution) is still
    // pending; replace-and-release instead of leaking its reservation.
    if (state.pendingPrompt && !state.pendingPrompt.terminal) {
      this.release(state.pendingPrompt, 'run-rejected')
    }
    state.pendingPrompt = run
  }

  /** Reserve a follow-up run. Throws (fail closed) when the sink rejects. */
  async reserveFollowUp(input: ReserveFollowUpInput): Promise<void> {
    const state = this.sessionState(input.sessionId)
    const key = followUpKey(input)
    const run = await this.reserve(
      input,
      'followup',
      `pi-run:${input.sessionId}:followup:${input.clientNonce}:${input.clientSeq}`,
    )
    if (key === undefined) {
      // Unreachable with current payload schemas (clientNonce is required);
      // never strand a reservation if that invariant changes.
      this.release(run, 'run-rejected')
      return
    }
    const previous = state.queued.get(key)
    if (previous && !previous.terminal) this.release(previous, 'run-rejected')
    state.queued.set(key, run)
  }

  /** The accepted prompt failed before/without running (sync throw or run rejection). */
  failPromptRun(sessionId: string, clientNonce: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const turnId = `pi-run:${sessionId}:prompt:${clientNonce}`
    if (state.pendingPrompt?.scope.turnId === turnId) {
      this.finishRun(state.pendingPrompt, 'error')
      state.pendingPrompt = undefined
      return
    }
    if (state.active?.scope.turnId === turnId) {
      this.finishRun(state.active, 'error')
      state.active = undefined
    }
  }

  /** A queued follow-up was rejected by the adapter before being queued. */
  failFollowUpRun(sessionId: string, selector: { clientNonce?: string; clientSeq?: number }): void {
    const state = this.sessions.get(sessionId)
    const key = followUpKey(selector)
    if (!state || key === undefined) return
    const run = state.queued.get(key)
    if (!run) return
    state.queued.delete(key)
    this.release(run, 'run-rejected')
  }

  /**
   * A queued follow-up is being re-posted as a plain prompt (interrupt
   * fallback for runtimes without continueQueuedFollowUp). No
   * `followup-consumed` event will arrive, so bind its reservation to the
   * next agent-start instead.
   */
  promoteQueuedToPrompt(sessionId: string, selector: { clientNonce?: string; clientSeq?: number }): void {
    const state = this.sessions.get(sessionId)
    const key = followUpKey(selector)
    if (!state || key === undefined) return
    const run = state.queued.get(key)
    if (!run) return
    state.queued.delete(key)
    if (state.pendingPrompt && !state.pendingPrompt.terminal) this.release(state.pendingPrompt, 'run-rejected')
    state.pendingPrompt = run
  }

  /** Queue cleared via selector or entirely; release affected reservations. */
  releaseQueued(sessionId: string, selector?: { clientNonce?: string; clientSeq?: number }): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    if (selector) {
      const key = followUpKey(selector)
      const run = key === undefined ? undefined : state.queued.get(key)
      if (key !== undefined && run) {
        state.queued.delete(key)
        this.release(run, 'queue-cleared')
      }
      return
    }
    for (const run of state.queued.values()) this.release(run, 'queue-cleared')
    state.queued.clear()
  }

  /** Session deleted: tear down every non-terminal run without charging. */
  releaseSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    for (const run of state.queued.values()) this.release(run, 'cancelled')
    if (state.pendingPrompt) this.release(state.pendingPrompt, 'cancelled')
    if (state.active) this.finishRun(state.active, 'aborted')
    this.sessions.delete(sessionId)
  }

  /**
   * Feed one native adapter event and its mapped PiChatEvents through the
   * correlation state machine. Must be called after the mapped events were
   * published (the mapper assigns turn ids during mapping).
   */
  observe(sessionId: string, nativeEvent: unknown, mappedEvents: readonly PiChatEvent[]): void {
    const state = this.sessions.get(sessionId)
    if (!state) return

    for (const event of mappedEvents) {
      switch (event.type) {
        case 'agent-start': {
          if (state.pendingPrompt) {
            if (state.active && !state.active.terminal) this.finishRun(state.active, 'ok')
            state.active = state.pendingPrompt
            state.pendingPrompt = undefined
          }
          break
        }
        case 'followup-consumed': {
          const key = followUpKey(event)
          const run = key === undefined ? undefined : state.queued.get(key)
          if (key !== undefined && run) {
            state.queued.delete(key)
            if (state.active && !state.active.terminal) this.finishRun(state.active, 'ok')
            state.active = run
          }
          break
        }
        case 'agent-end': {
          if (state.active && !state.active.terminal) this.finishRun(state.active, event.status)
          state.active = undefined
          break
        }
        default:
          break
      }
    }

    this.observeNativeUsage(state, nativeEvent)
  }

  /** Test/diagnostic hook: resolves after every queued sink call settles. */
  async flush(): Promise<void> {
    // Sink calls can enqueue while we await (usage then settle), so drain
    // until the in-flight set is stable.
    while (this.inflightOps.size > 0) {
      await Promise.all([...this.inflightOps])
    }
  }

  private observeNativeUsage(state: SessionMeteringState, nativeEvent: unknown): void {
    if (!isRecord(nativeEvent) || nativeEvent.type !== 'message_end') return
    const message = nativeEvent.message
    if (!isRecord(message) || message.role !== 'assistant') return
    const usage = normalizeMeteringUsage(message.usage)
    if (!usage) return

    const run = state.active ?? state.pendingPrompt
    if (!run || run.terminal) {
      this.logError('assistant usage arrived with no reserved run; usage not metered', { messageRole: 'assistant' })
      return
    }

    run.usageCount += 1
    const messageId = typeof message.id === 'string' && message.id.length > 0 ? message.id : undefined
    const model = typeof message.model === 'string' && message.model.length > 0 ? message.model : undefined
    const provider = typeof message.provider === 'string' && message.provider.length > 0 ? message.provider : undefined
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined
    const usageId = messageId
      ? `pi-usage:${run.scope.sessionId}:message:${messageId}`
      : `pi-usage:${run.scope.turnId}:${run.usageCount}`

    this.enqueue(run, () =>
      this.sink.recordUsage({
        ...run.scope,
        reservationId: run.reservationId,
        usageId,
        messageId,
        model: model || provider ? { provider, id: model } : undefined,
        usage,
        stopReason,
      }),
      'recordUsage failed',
    )
  }

  private async reserve(
    input: ReservePromptInput,
    kind: MeteringRunKind,
    turnId: string,
  ): Promise<MeteringRun> {
    const scope: MeteringRunScope = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      sessionId: input.sessionId,
      turnId,
      source: 'pi-chat',
    }
    const result = await this.sink.reserveRun({
      ...scope,
      kind,
      message: input.message,
      model: input.model,
    })
    return {
      scope,
      kind,
      reservationId: result?.reservationId,
      usageCount: 0,
      terminal: false,
      ops: Promise.resolve(),
    }
  }

  private finishRun(run: MeteringRun, status: MeteringRunStatus): void {
    if (run.terminal) return
    if (status !== 'ok' && run.usageCount === 0) {
      this.release(run, status === 'error' ? 'error-before-usage' : 'cancelled')
      return
    }
    run.terminal = true
    this.enqueue(run, () =>
      this.sink.settleRun({ ...run.scope, reservationId: run.reservationId, status }),
      'settleRun failed',
    )
  }

  private release(run: MeteringRun, reason: MeteringReleaseReason): void {
    if (run.terminal) return
    run.terminal = true
    this.enqueue(run, () =>
      this.sink.releaseRun({ ...run.scope, reservationId: run.reservationId, reason }),
      'releaseRun failed',
    )
  }

  private enqueue(run: MeteringRun, op: () => Promise<void>, failureMessage: string): void {
    const chained = run.ops.then(op).catch((error) => {
      this.logError(`${failureMessage} (turn ${run.scope.turnId})`, error)
    })
    run.ops = chained
    this.inflightOps.add(chained)
    void chained.finally(() => this.inflightOps.delete(chained))
  }

  private sessionState(sessionId: string): SessionMeteringState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { queued: new Map() }
      this.sessions.set(sessionId, state)
    }
    return state
  }
}
