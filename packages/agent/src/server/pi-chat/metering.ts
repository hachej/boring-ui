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
  | 'usage-write-failed'

export interface MeteringReleaseInput extends MeteringRunScope {
  reservationId?: string
  reason: MeteringReleaseReason
}

export type MeteringErrorLogger = (message: string, error: unknown) => void

/**
 * Result of an accepted prompt/follow-up reservation:
 * - `created`   a new run was reserved; execute it.
 * - `duplicate` another run already owns this nonce; skip execution.
 * - `cancelled` a concurrent stop/interrupt/delete terminated the run while the
 *               reservation was in flight; skip execution (the hold is released).
 */
export type ReserveOutcome = 'created' | 'duplicate' | 'cancelled'

const meteringLogger = createLogger('pi-chat-metering')

const defaultMeteringErrorLogger: MeteringErrorLogger = (message, error) => {
  meteringLogger.warn(message, { error })
}

interface FollowUpSelector {
  clientNonce?: string
  clientSeq?: number
}

interface MeteringRun {
  scope: MeteringRunScope
  kind: MeteringRunKind
  reservationId?: string
  /** Monotonic per-coordinator run instance. runId is reused when a client
   * replays a nonce after completion, so this distinguishes id-less usage rows
   * across run instances. */
  instanceId: number
  usageCount: number
  /** Count of recorded usage rows that carried positive tokens. A successful run
   * with only zero-token usage (provider reported no/zero tokens) must not settle
   * a paid hold for free — it falls back to the hold like a missing-usage run. */
  billableUsageCount: number
  /** Message ids recorded this attempt (id-ful dedup of repeat message_end and
   * the agent_end echo). Cleared on auto-retry. */
  recordedMessageIds: Set<string>
  /** Usage signature of the most recent id-less message recorded this attempt,
   * so only the agent_end ECHO of it is skipped — distinct id-less messages
   * (e.g. tool-loop calls) with the same usage are still each metered. */
  lastIdlessUsageKey?: string
  /** Set when a recordUsage sink call rejected — at least one ledger row for
   * this run is missing, so the run must not falsely settle. */
  usageWriteFailed: boolean
  /** Set once the run reached agent-start (execution began). A run that STARTED
   * then errored/cancelled with no usage may have made a paid provider call
   * before Pi emitted usage, so it must NOT be released free — it falls through
   * to the fallback hold charge. Only a NOT-started terminal run is freed. */
  started: boolean
  /** Present on queued follow-up runs; matched against clear/consume selectors. */
  followUp?: FollowUpSelector
  /** Resolves/rejects when the host reservation settles. Awaited by concurrent
   * duplicates so they observe the owner's accept/reject. */
  reservation: Promise<void>
  terminal: boolean
  /** Serializes sink calls per run so settle/release never overtakes usage and
   * release never overtakes the reservation insert. */
  ops: Promise<void>
}

interface SessionMeteringState {
  /** Reserved prompt runs awaiting their agent-start, in acceptance order. */
  pendingPrompts: MeteringRun[]
  /** Run currently attributed native usage. */
  active?: MeteringRun
  /** Reserved follow-up runs awaiting consumption. */
  queued: MeteringRun[]
  /** Client nonces of follow-ups already consumed this session. Mirrors the Pi
   * adapter's post-consumption nonce memory so a retry of a consumed follow-up
   * is suppressed instead of reserving a hold the adapter will never enqueue. */
  consumedFollowUpNonces: Set<string>
}

// Run ids key the store's per-(runId, userId) reservation idempotency. They
// intentionally omit workspaceId: a Pi session is bound to one workspace by the
// session access policy (belongsToContext), so the same user cannot drive the
// same sessionId — and thus the same runId — under two workspaces.
function promptRunId(sessionId: string, clientNonce: string): string {
  return `pi-run:${sessionId}:prompt:${clientNonce}`
}

function followUpRunId(sessionId: string, clientNonce: string, clientSeq: number): string {
  return `pi-run:${sessionId}:followup:${clientNonce}:${clientSeq}`
}

/** A clear/consume selector matches a queued run by whichever field it carries
 * (nonce preferred). clearQueue may pass nonce-only OR seq-only, while runs
 * always store both — so matching by one field, not a single composite key, is
 * what lets a seq-only clear find a run. */
function followUpMatches(run: MeteringRun, selector: FollowUpSelector): boolean {
  const fu = run.followUp
  if (!fu) return false
  if (selector.clientNonce !== undefined) return fu.clientNonce === selector.clientNonce
  if (selector.clientSeq !== undefined) return fu.clientSeq === selector.clientSeq
  return false
}

function takeQueuedFollowUp(state: SessionMeteringState, selector: FollowUpSelector): MeteringRun | undefined {
  const index = state.queued.findIndex((run) => followUpMatches(run, selector))
  if (index < 0) return undefined
  return state.queued.splice(index, 1)[0]
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
  private runInstances = 0
  private readonly sink: AgentMeteringSink
  private readonly logError: MeteringErrorLogger

  constructor(sink: AgentMeteringSink, logError?: MeteringErrorLogger) {
    this.sink = sink
    this.logError = logError ?? defaultMeteringErrorLogger
  }

  /** Reserve a prompt run. Throws (fail closed) when the sink rejects. */
  async reservePrompt(input: ReservePromptInput): Promise<ReserveOutcome> {
    const state = this.sessionState(input.sessionId)
    const runId = promptRunId(input.sessionId, input.clientNonce)
    // Duplicate (incl. two concurrent retries racing the gap before the async
    // reserve resolves): the run is registered synchronously below, so the
    // loser's findRun sees it. Await the owner's reservation so a duplicate
    // reports the same accept/reject (the await re-throws an owner rejection),
    // then skip execution.
    const existing = this.findRun(state, runId)
    if (existing) {
      await existing.reservation
      return 'duplicate'
    }
    const run = this.createRun(input, 'prompt', runId)
    state.pendingPrompts.push(run)
    return this.materializeReservation(state, run, input)
  }

  /** Reserve a follow-up run. Throws (fail closed) when the sink rejects.
   * Returns 'duplicate' when this selector already has a tracked/consumed run. */
  async reserveFollowUp(input: ReserveFollowUpInput): Promise<ReserveOutcome> {
    const state = this.sessionState(input.sessionId)
    const runId = followUpRunId(input.sessionId, input.clientNonce, input.clientSeq)
    const existing = this.findRun(state, runId)
    if (existing) {
      await existing.reservation
      return 'duplicate'
    }
    // A consumed follow-up's nonce stays in the Pi adapter's memory, so a retry
    // would reserve a hold the adapter silently drops. Suppress it.
    if (state.consumedFollowUpNonces.has(input.clientNonce)) return 'duplicate'
    const run = this.createRun(input, 'followup', runId)
    run.followUp = { clientNonce: input.clientNonce, clientSeq: input.clientSeq }
    state.queued.push(run)
    return this.materializeReservation(state, run, input)
  }

  /**
   * Acquire the reservation for a freshly-registered run. The reserve is put on
   * the run's ops chain so a concurrent release/settle is ordered strictly
   * after the reservation row exists. Returns 'cancelled' (skip execution) when
   * a concurrent stop/interrupt/delete terminated the run while the reserve was
   * in flight; throws (fail closed) when the sink rejects.
   */
  private async materializeReservation(
    state: SessionMeteringState,
    run: MeteringRun,
    input: ReservePromptInput,
  ): Promise<ReserveOutcome> {
    run.reservation = this.applyReservation(run, input)
    const reserveOp = run.reservation.catch(() => {})
    run.ops = reserveOp
    this.inflightOps.add(reserveOp)
    void reserveOp.finally(() => this.inflightOps.delete(reserveOp))
    try {
      await run.reservation
    } catch (err) {
      this.removeReservingRun(state, run, input.sessionId)
      throw err
    }
    // Cancelled mid-reserve: the release is already queued behind the reserve on
    // run.ops, so the hold is cleaned up — just don't execute.
    return run.terminal ? 'cancelled' : 'created'
  }

  /** True while a non-terminal prompt run exists for this nonce (accept →
   * agent-end). Used to suppress duplicate-nonce execution for the full run
   * lifetime, not just until the user message-start is consumed. */
  hasPromptRun(sessionId: string, clientNonce: string): boolean {
    const state = this.sessions.get(sessionId)
    if (!state) return false
    const run = this.findRun(state, promptRunId(sessionId, clientNonce))
    return run !== undefined && !run.terminal
  }

  /** True while a non-terminal follow-up run exists for this selector (queued
   * or consumed-and-active). Used to suppress duplicate follow-up enqueues. */
  hasFollowUpRun(sessionId: string, selector: FollowUpSelector): boolean {
    const state = this.sessions.get(sessionId)
    if (!state) return false
    if (selector.clientNonce !== undefined && state.consumedFollowUpNonces.has(selector.clientNonce)) return true
    if (state.queued.some((run) => followUpMatches(run, selector))) return true
    const active = state.active
    return active !== undefined && !active.terminal && active.followUp !== undefined && followUpMatches(active, selector)
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
  failFollowUpRun(sessionId: string, selector: FollowUpSelector): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const run = takeQueuedFollowUp(state, selector)
    if (!run) return
    this.release(run, 'run-rejected')
    this.pruneSession(sessionId, state)
  }

  /**
   * A queued follow-up is being re-posted as a plain prompt (interrupt
   * fallback for runtimes without continueQueuedFollowUp). No
   * `followup-consumed` event will arrive, so bind its reservation to the
   * next agent-start instead.
   */
  promoteQueuedToPrompt(sessionId: string, selector: FollowUpSelector): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const run = takeQueuedFollowUp(state, selector)
    if (!run) return
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
  releaseQueued(sessionId: string, selector?: FollowUpSelector): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    if (selector) {
      const run = takeQueuedFollowUp(state, selector)
      if (run) this.release(run, 'queue-cleared')
    } else {
      for (const run of state.queued) this.release(run, 'queue-cleared')
      state.queued = []
    }
    this.pruneSession(sessionId, state)
  }

  /** Session deleted: tear down every non-terminal run without charging. */
  releaseSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    for (const run of state.queued) this.release(run, 'cancelled')
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
            next.started = true // execution began — a later no-usage error is charged, not freed
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
        case 'auto-retry-start': {
          // New attempt for the same run: reset per-attempt usage dedup so the
          // next attempt's usage (notably id-less) meters independently.
          if (state.active) {
            state.active.recordedMessageIds.clear()
            state.active.lastIdlessUsageKey = undefined
          }
          break
        }
        case 'agent-end': {
          // Harvest authoritative usage riding on agent_end first (deduped by
          // message id) — a willRetry attempt may still carry real, billed
          // token usage for the failed attempt.
          this.harvestAgentEndUsage(state, nativeEvent)
          // Pi auto-retries inside the same run (agent_end with willRetry,
          // then auto_retry_* events, then the retried stream — without a new
          // agent_start). Don't terminate: the run continues for the retry.
          if (isRecord(nativeEvent) && nativeEvent.willRetry === true) break
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
  private consumeFollowUp(state: SessionMeteringState, selector: FollowUpSelector): void {
    const run = takeQueuedFollowUp(state, selector)
    if (!run) return
    if (run.followUp?.clientNonce) state.consumedFollowUpNonces.add(run.followUp.clientNonce)
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
      this.recordAssistantUsage(state, message, { isAgentEndFinal: true })
      return
    }
  }

  private recordAssistantUsage(
    state: SessionMeteringState,
    message: unknown,
    opts: { isAgentEndFinal?: boolean } = {},
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
      // id-ful: exact dedup of a repeat message_end and the agent_end echo.
      if (run.recordedMessageIds.has(messageId)) return
      run.recordedMessageIds.add(messageId)
    } else {
      // id-less: a message_end records unconditionally (distinct tool-loop calls
      // can share a usage signature). Only the agent_end ECHO of the most
      // recent id-less message is skipped.
      const stopReason = typeof message.stopReason === 'string' ? message.stopReason : ''
      const signature = `sig:${usage.input}:${usage.output}:${usage.cacheRead}:${usage.cacheWrite}:${usage.cost.total}:${stopReason}`
      if (opts.isAgentEndFinal && signature === run.lastIdlessUsageKey) return
      run.lastIdlessUsageKey = signature
    }

    run.usageCount += 1
    if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) run.billableUsageCount += 1
    const model = typeof message.model === 'string' && message.model.length > 0 ? message.model : undefined
    const provider = typeof message.provider === 'string' && message.provider.length > 0 ? message.provider : undefined
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined
    // Stable usage id for ledger idempotency. Native id when present. Otherwise
    // prefer the persisted reservationId: it's DB-assigned (stable across
    // process restarts) and distinct per reserve — and the store's idempotent
    // reserve hands a crash-retry of the same runId back the SAME reservation,
    // so the retried usage id matches and is deduped rather than double-billed.
    // Only when the sink returns no reservationId do we fall back to the
    // process-local run instance (best effort).
    // The reservationId is carried in the usage metadata, so the store's
    // recordUsage verifies it on an id collision: a reused session:message id from
    // a DIFFERENT reservation (client-nonce replay) fails the match and throws,
    // routing the run to the fallback hold charge instead of settling it free.
    const usageId = messageId
      ? `pi-usage:${run.scope.sessionId}:message:${messageId}`
      : run.reservationId
        ? `pi-usage:reservation:${run.reservationId}:${run.usageCount}`
        : `pi-usage:${run.scope.runId}:${run.instanceId}:${run.usageCount}`

    this.enqueue(run, async () => {
      try {
        await this.sink.recordUsage({
          ...run.scope,
          reservationId: run.reservationId,
          usageId,
          messageId,
          model: model || provider ? { provider, id: model } : undefined,
          usage,
          stopReason,
        })
      } catch (error) {
        run.usageWriteFailed = true
        throw error
      }
    },
      'recordUsage failed',
    )
  }

  /** Build a run synchronously (no await) so it can be registered before the
   * reserve sink call, closing the concurrent-duplicate race. */
  private createRun(input: ReservePromptInput, kind: MeteringRunKind, runId: string): MeteringRun {
    return {
      scope: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        sessionId: input.sessionId,
        runId,
        source: 'pi-chat',
      },
      kind,
      reservationId: undefined,
      instanceId: (this.runInstances += 1),
      usageCount: 0,
      billableUsageCount: 0,
      started: false,
      recordedMessageIds: new Set(),
      lastIdlessUsageKey: undefined,
      usageWriteFailed: false,
      reservation: Promise.resolve(),
      terminal: false,
      ops: Promise.resolve(),
    }
  }

  /** Acquire the host reservation; throws (fail closed) on a rejecting sink. */
  private async applyReservation(run: MeteringRun, input: ReservePromptInput): Promise<void> {
    const result = await this.sink.reserveRun({
      ...run.scope,
      kind: run.kind,
      message: input.message,
      model: input.model,
    })
    run.reservationId = result?.reservationId
  }

  /** Remove a still-reserving run whose reservation failed, from either list. */
  private removeReservingRun(state: SessionMeteringState, run: MeteringRun, sessionId: string): void {
    const pendingIndex = state.pendingPrompts.indexOf(run)
    if (pendingIndex >= 0) state.pendingPrompts.splice(pendingIndex, 1)
    const queuedIndex = state.queued.indexOf(run)
    if (queuedIndex >= 0) state.queued.splice(queuedIndex, 1)
    this.pruneSession(sessionId, state)
  }

  private findRun(state: SessionMeteringState, runId: string): MeteringRun | undefined {
    if (state.active && !state.active.terminal && state.active.scope.runId === runId) return state.active
    const pending = state.pendingPrompts.find((run) => run.scope.runId === runId)
    if (pending) return pending
    return state.queued.find((run) => run.scope.runId === runId)
  }

  private finishRun(run: MeteringRun, status: MeteringRunStatus): void {
    if (run.terminal) return
    if (status !== 'ok' && run.usageCount === 0) {
      // Free release is safe UNLESS the run actually started AND errored: a
      // provider/network failure after agent_start may have made a paid model
      // call whose usage object never arrived → fall through to the fallback hold
      // charge. A user-initiated abort/cancel with zero usage stays free: Pi
      // delivers a usage row whenever billable tokens were produced, so zero
      // usage means nothing billable was generated (charging the full worst-case
      // hold for an instant-stop would grossly over-charge).
      const startedError = status === 'error' && run.started
      if (!startedError) {
        this.release(run, status === 'error' ? 'error-before-usage' : 'cancelled')
        return
      }
    }
    run.terminal = true
    // A SUCCESSFUL run that recorded no usage (provider reported none/zero), or
    // one whose usage write failed, has no ledger debit — settling would return a
    // paid hold for free. Charge the fallback hold instead (the sink's
    // usage-write-failed path), so an executed run is never free. Decided inside
    // the op so it observes the usage writes queued ahead of it on the chain.
    this.enqueue(run, () => {
      // Missing usage = a failed write, OR no usage row carried positive tokens
      // (provider reported none/zero). Either way there's no real debit, so
      // fall back to the hold rather than settle a paid run for free.
      const missingUsage = run.usageWriteFailed || run.billableUsageCount === 0
      return missingUsage
        ? this.sink.releaseRun({ ...run.scope, reservationId: run.reservationId, reason: 'usage-write-failed' })
        : this.sink.settleRun({ ...run.scope, reservationId: run.reservationId, status })
    },
      'finishRun failed',
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
      state = { pendingPrompts: [], queued: [], consumedFollowUpNonces: new Set() }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private pruneSession(sessionId: string, state: SessionMeteringState): void {
    // Keep sessions that hold consumed follow-up nonce memory (mirrors the Pi
    // adapter channel's lifetime; both are cleared on deleteSession).
    if (
      !state.active &&
      state.pendingPrompts.length === 0 &&
      state.queued.length === 0 &&
      state.consumedFollowUpNonces.size === 0
    ) {
      this.sessions.delete(sessionId)
    }
  }
}
