import type { ChatModelSelection, PiChatEvent } from '../../shared/chat'
import { createLogger } from '../logging'

/**
 * Generic metering seam for hosts that bill native Pi usage.
 *
 * The agent package owns lifecycle correctness (when to reserve, record,
 * settle, release based on native Pi events); the host-provided sink owns
 * persistence and product policy (credits, pricing, currencies, hard stops).
 *
 * Lifecycle per accepted prompt/follow-up ("run", identified by `runId`):
 *
 *   reserveRun        before execution starts; throwing rejects the request
 *                     (fail closed) so hosts can enforce hard stops.
 *   recordUsage       once per native assistant message carrying usage.
 *                     `usageId` is a stable idempotency key.
 *   settleRun         when the run reaches a native terminal state and usage
 *                     was recorded (or it finished ok).
 *   releaseRun        when the run never produced billable usage: rejected
 *                     execution, cleared queue, cancel/abort, or error before
 *                     any usage arrived.
 *
 * Every run terminates with exactly one settle or release from the
 * coordinator; sinks should still treat all four methods as idempotent
 * because process restarts and client retries can replay transitions.
 */
export interface AgentMeteringSink {
  reserveRun(input: MeteringReserveInput): Promise<MeteringReservationResult>
  recordUsage(input: MeteringUsageInput): Promise<void>
  settleRun(input: MeteringSettleInput): Promise<void>
  releaseRun(input: MeteringReleaseInput): Promise<void>
}

export interface MeteringRunScope {
  workspaceId: string
  userId?: string
  sessionId: string
  /** Stable id for one accepted prompt/follow-up run. */
  runId: string
  source: 'pi-chat'
}

export type MeteringRunKind = 'prompt' | 'followup'

export interface MeteringReserveInput extends MeteringRunScope {
  kind: MeteringRunKind
  message: string
  model?: ChatModelSelection
}

/** Sinks without reservation rows can return an empty object. */
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
  /** Message ids already recorded, so agent_end finals don't double-record. */
  recordedMessageIds: Set<string>
  terminal: boolean
  /** Serializes sink calls per run so settle/release never overtakes usage. */
  ops: Promise<void>
}

interface SessionMeteringState {
  /** Reserved prompt runs awaiting their agent-start, in acceptance order. */
  pendingPrompts: MeteringRun[]
  /** Run currently attributed native usage. */
  active?: MeteringRun
  /** Reserved follow-up runs awaiting consumption, keyed by nonce/seq. */
  queued: Map<string, MeteringRun>
}

function promptRunId(sessionId: string, clientNonce: string): string {
  return `pi-run:${sessionId}:prompt:${clientNonce}`
}

function followUpRunId(sessionId: string, clientNonce: string, clientSeq: number): string {
  return `pi-run:${sessionId}:followup:${clientNonce}:${clientSeq}`
}

function followUpKey(selector: { clientNonce?: string; clientSeq?: number }): string | undefined {
  if (selector.clientNonce) return `nonce:${selector.clientNonce}`
  if (selector.clientSeq !== undefined) return `seq:${selector.clientSeq}`
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Native Pi usage objects always carry token + cost breakdowns; normalize
 * defensively (zero-filling gaps and clamping negatives) so a partial object
 * from an unexpected provider still meters as zeros instead of NaN. */
export function normalizeMeteringUsage(value: unknown): MeteringUsage | undefined {
  if (!isRecord(value)) return undefined
  const cost = isRecord(value.cost) ? value.cost : {}
  return {
    input: readTokenCount(value.input),
    output: readTokenCount(value.output),
    cacheRead: readTokenCount(value.cacheRead),
    cacheWrite: readTokenCount(value.cacheWrite),
    cost: {
      input: readTokenCount(cost.input),
      output: readTokenCount(cost.output),
      cacheRead: readTokenCount(cost.cacheRead),
      cacheWrite: readTokenCount(cost.cacheWrite),
      total: readTokenCount(cost.total),
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
 * Correlation model: accepted prompts queue in order and bind to agent-start
 * events FIFO; queued follow-ups become active when their `followup-consumed`
 * event arrives (settling the previous active run, which is how each user
 * input is metered independently even though Pi runs them inside one agent
 * loop). Native assistant usage (message_end, or the final assistant entry
 * riding on agent_end) is attributed to the active run. An agent_end with
 * `willRetry` is not terminal: Pi continues the same run after auto-retry.
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
    const runId = promptRunId(input.sessionId, input.clientNonce)
    // A client retry of the same nonce re-validates the balance through the
    // sink (reserveRun is idempotent per runId) but must not double-track or
    // release the in-flight run.
    if (this.findRun(state, runId)) {
      await this.reserve(input, 'prompt', runId)
      return
    }
    state.pendingPrompts.push(await this.reserve(input, 'prompt', runId))
  }

  /** Reserve a follow-up run. Throws (fail closed) when the sink rejects. */
  async reserveFollowUp(input: ReserveFollowUpInput): Promise<void> {
    const state = this.sessionState(input.sessionId)
    const runId = followUpRunId(input.sessionId, input.clientNonce, input.clientSeq)
    if (this.findRun(state, runId)) {
      await this.reserve(input, 'followup', runId)
      return
    }
    const run = await this.reserve(input, 'followup', runId)
    const key = followUpKey(input)
    if (key === undefined) {
      // Unreachable with current payload schemas (clientNonce is required);
      // never strand a reservation if that invariant changes.
      this.release(run, 'run-rejected')
      return
    }
    state.queued.set(key, run)
  }

  /** The accepted prompt failed before/without running (sync throw or run rejection). */
  failPromptRun(sessionId: string, clientNonce: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const runId = promptRunId(sessionId, clientNonce)
    const pendingIndex = state.pendingPrompts.findIndex((run) => run.scope.runId === runId)
    if (pendingIndex >= 0) {
      const [run] = state.pendingPrompts.splice(pendingIndex, 1)
      if (run) this.finishRun(run, 'error')
    } else if (state.active?.scope.runId === runId) {
      this.finishRun(state.active, 'error')
      state.active = undefined
    }
    this.pruneSession(sessionId, state)
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
    this.pruneSession(sessionId, state)
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
    state.pendingPrompts.push(run)
  }

  /**
   * A promoted-to-prompt follow-up failed before agent-start (the fallback
   * repost rejected). Release its reservation instead of stranding it in
   * pendingPrompts, where a later agent-start would otherwise misattribute
   * usage to it.
   */
  failPromotedFollowUp(sessionId: string, selector: { clientNonce?: string; clientSeq?: number }): void {
    const state = this.sessions.get(sessionId)
    if (!state || selector.clientNonce === undefined || selector.clientSeq === undefined) return
    const runId = followUpRunId(sessionId, selector.clientNonce, selector.clientSeq)
    const index = state.pendingPrompts.findIndex((run) => run.scope.runId === runId)
    if (index < 0) return
    const [run] = state.pendingPrompts.splice(index, 1)
    if (run) this.release(run, 'run-rejected')
    this.pruneSession(sessionId, state)
  }

  /**
   * Release prompt runs reserved but not yet bound to an agent-start —
   * e.g. a stop/interrupt landing in the window between acceptance and the
   * native agent_start. Without this they would sit `active` in the store
   * until their TTL, holding the user's balance. No charge.
   */
  releasePending(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    for (const run of state.pendingPrompts) this.release(run, 'cancelled')
    state.pendingPrompts = []
    this.pruneSession(sessionId, state)
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
    } else {
      for (const run of state.queued.values()) this.release(run, 'queue-cleared')
      state.queued.clear()
    }
    this.pruneSession(sessionId, state)
  }

  /** Session deleted: tear down every non-terminal run without charging. */
  releaseSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    for (const run of state.queued.values()) this.release(run, 'cancelled')
    for (const run of state.pendingPrompts) this.release(run, 'cancelled')
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
          // Skip pending runs already released (e.g. raced with stop) so usage
          // is never attributed to a terminal run.
          let next = state.pendingPrompts.shift()
          while (next && next.terminal) next = state.pendingPrompts.shift()
          if (next) {
            if (state.active && !state.active.terminal) this.finishRun(state.active, 'ok')
            state.active = next
          }
          break
        }
        case 'message-start': {
          // Production consumption signal: an enriched user message-start
          // carrying a follow-up selector (clientSeq present). Idempotent with
          // the explicit followup-consumed event below — whichever lands first
          // removes the run from the queue.
          if (event.role === 'user' && event.clientSeq !== undefined) {
            this.consumeFollowUp(state, event)
          }
          break
        }
        case 'followup-consumed': {
          this.consumeFollowUp(state, event)
          break
        }
        case 'agent-end': {
          // Pi auto-retries inside the same run (agent_end with willRetry,
          // then auto_retry_* events, then the retried stream — without a new
          // agent_start). Terminating here would release the reservation and
          // drop the retried completion's usage.
          if (isRecord(nativeEvent) && nativeEvent.willRetry === true) break
          this.harvestAgentEndUsage(state, nativeEvent)
          if (state.active && !state.active.terminal) this.finishRun(state.active, event.status)
          state.active = undefined
          break
        }
        default:
          break
      }
    }

    this.observeMessageEndUsage(state, nativeEvent)
    this.pruneSession(sessionId, state)
  }

  /** Promote a queued follow-up to the active run, settling the previous one. */
  private consumeFollowUp(state: SessionMeteringState, selector: { clientNonce?: string; clientSeq?: number }): void {
    const key = followUpKey(selector)
    const run = key === undefined ? undefined : state.queued.get(key)
    if (key === undefined || !run) return
    state.queued.delete(key)
    if (state.active && !state.active.terminal) this.finishRun(state.active, 'ok')
    state.active = run
  }

  /** Test/diagnostic hook: resolves after every queued sink call settles. */
  async flush(): Promise<void> {
    // Sink calls can enqueue while we await (usage then settle), so drain
    // until the in-flight set is stable.
    while (this.inflightOps.size > 0) {
      await Promise.all([...this.inflightOps])
    }
  }

  private observeMessageEndUsage(state: SessionMeteringState, nativeEvent: unknown): void {
    if (!isRecord(nativeEvent) || nativeEvent.type !== 'message_end') return
    this.recordAssistantUsage(state, nativeEvent.message)
  }

  /**
   * Some failure/abort paths never emit message_end; the final assistant
   * message (and its usage) only rides on agent_end's messages array. Runs
   * with already-recorded usage dedupe via recordedMessageIds.
   */
  private harvestAgentEndUsage(state: SessionMeteringState, nativeEvent: unknown): void {
    if (!isRecord(nativeEvent) || !Array.isArray(nativeEvent.messages)) return
    for (let index = nativeEvent.messages.length - 1; index >= 0; index -= 1) {
      const message = nativeEvent.messages[index]
      if (!isRecord(message) || message.role !== 'assistant') continue
      this.recordAssistantUsage(state, message, { finalFallback: true })
      return
    }
  }

  private recordAssistantUsage(
    state: SessionMeteringState,
    message: unknown,
    opts: { finalFallback?: boolean } = {},
  ): void {
    if (!isRecord(message) || message.role !== 'assistant') return
    const usage = normalizeMeteringUsage(message.usage)
    if (!usage) return

    const run = state.active ?? state.pendingPrompts[0]
    if (!run || run.terminal) {
      this.logError('assistant usage arrived with no reserved run; usage not metered', { messageRole: 'assistant' })
      return
    }

    const messageId = typeof message.id === 'string' && message.id.length > 0 ? message.id : undefined
    if (messageId) {
      if (run.recordedMessageIds.has(messageId)) return
      run.recordedMessageIds.add(messageId)
    } else if (opts.finalFallback && run.usageCount > 0) {
      // An id-less agent_end final after message_end usage was already
      // recorded is almost certainly the same message; skip rather than
      // double-bill.
      return
    }

    run.usageCount += 1
    const model = typeof message.model === 'string' && message.model.length > 0 ? message.model : undefined
    const provider = typeof message.provider === 'string' && message.provider.length > 0 ? message.provider : undefined
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined
    const usageId = messageId
      ? `pi-usage:${run.scope.sessionId}:message:${messageId}`
      : `pi-usage:${run.scope.runId}:${run.usageCount}`

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
    runId: string,
  ): Promise<MeteringRun> {
    const scope: MeteringRunScope = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      sessionId: input.sessionId,
      runId,
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
      recordedMessageIds: new Set(),
      terminal: false,
      ops: Promise.resolve(),
    }
  }

  private findRun(state: SessionMeteringState, runId: string): MeteringRun | undefined {
    if (state.active && !state.active.terminal && state.active.scope.runId === runId) return state.active
    const pending = state.pendingPrompts.find((run) => run.scope.runId === runId)
    if (pending) return pending
    for (const run of state.queued.values()) {
      if (run.scope.runId === runId) return run
    }
    return undefined
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
      this.logError(`${failureMessage} (run ${run.scope.runId})`, error)
    })
    run.ops = chained
    this.inflightOps.add(chained)
    void chained.finally(() => this.inflightOps.delete(chained))
  }

  private sessionState(sessionId: string): SessionMeteringState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { pendingPrompts: [], queued: new Map() }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private pruneSession(sessionId: string, state: SessionMeteringState): void {
    if (!state.active && state.pendingPrompts.length === 0 && state.queued.size === 0) {
      this.sessions.delete(sessionId)
    }
  }
}
