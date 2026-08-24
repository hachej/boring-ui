import type {
  ChatAttachmentPayload,
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptReceipt,
  InterruptPayload,
  PiChatStatus,
  PromptPayload,
  PromptReceipt,
  QueuedUserMessage,
  QueueClearPayload,
  QueueClearReceipt,
  StopReceipt,
} from '../../../shared/chat'
import type { PiChatState } from './piChatReducer'

export interface PiQueueSessionLike {
  getState(): PiChatState
  prompt(payload: PromptPayload): Promise<PromptReceipt>
  followUp(payload: FollowUpPayload): Promise<FollowUpReceipt>
  clearQueue(payload?: QueueClearPayload): Promise<QueueClearReceipt>
  interrupt(payload?: InterruptPayload): Promise<InterruptReceipt>
  stop(): Promise<StopReceipt>
}

export interface PiQueueSubmitInput {
  text: string
  displayText?: string
  attachments?: ChatAttachmentPayload[]
  model?: PromptPayload['model']
  thinkingLevel?: PromptPayload['thinkingLevel']
  /** Later composer policy may mark expanded prompt-template slash commands as normal text. */
  kind?: 'normal' | 'slash-command' | 'expanded-text'
}

export interface PiQueueControllerOptions {
  createClientNonce?: () => string
  onDraftChange?: (draft: string) => void
  getDraft?: () => string
  onWarning?: (message: string) => void
  onPromptSubmitStarted?: (clientNonce: string) => void
  allowPromptDuringInitialHydration?: boolean
  coordinationKey?: object
}

export type PiQueueSubmitResult =
  | { type: 'prompt'; clientNonce: string; cursor?: number }
  | { type: 'followup'; clientNonce: string; clientSeq: number; cursor?: number }
  | { type: 'blocked'; reason: 'empty' | 'hydrating' | 'busy-attachments' | 'busy-slash-command'; message: string }

export type PiQueueEditQueuedResult =
  | { type: 'cleared'; draft: string }
  | { type: 'empty'; message: string }
  | { type: 'clear-failed'; draft: string; error: unknown; message: string }

interface QueueRecoveryCoordination {
  inFlight?: Promise<PiQueueEditQueuedResult>
  readonly recoveredSelectors: Map<string, string>
  recoveredBlock: string
}

const queueRecoveryByKey = new WeakMap<object, QueueRecoveryCoordination>()

export class PiFollowUpQueueController {
  private nextClientSeqFloor: number | undefined

  constructor(
    private readonly session: PiQueueSessionLike,
    private readonly options: PiQueueControllerOptions = {},
  ) {}

  async submit(input: PiQueueSubmitInput): Promise<PiQueueSubmitResult> {
    const text = input.text.trim()
    const attachments = input.attachments ?? []
    if (!text) {
      return this.block('empty', 'Enter a message before sending.')
    }

    const state = this.session.getState()
    if (state.status === 'hydrating' && !(this.options.allowPromptDuringInitialHydration === true && canPromptDuringInitialHydration(state))) {
      return this.block('hydrating', 'The agent session is still hydrating.')
    }

    if (state.status === 'idle' && hasPendingOptimisticPromptInEmptySession(state)) {
      return this.block('hydrating', 'The agent session is still hydrating.')
    }

    if (isPiChatBusy(state.status)) {
      if (attachments.length > 0) {
        return this.block('busy-attachments', 'Attachments cannot be queued while the agent is responding. Send them after the current response finishes.')
      }
      if (isBusySlashCommand(input)) {
        return this.block('busy-slash-command', 'Slash commands are not queued while the agent is responding.')
      }

      const clientNonce = this.createClientNonce()
      const clientSeq = this.nextFollowUpClientSeq()
      const receipt = await this.session.followUp({ message: text, ...(input.displayText ? { displayMessage: input.displayText } : {}), clientNonce, clientSeq })
      return { type: 'followup', clientNonce, clientSeq, cursor: receipt.cursor }
    }

    const clientNonce = this.createClientNonce()
    this.options.onPromptSubmitStarted?.(clientNonce)
    const receipt = await this.session.prompt({
      message: text,
      ...(input.displayText ? { displayMessage: input.displayText } : {}),
      clientNonce,
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    })
    return { type: 'prompt', clientNonce, cursor: receipt.cursor }
  }

  editQueued(): Promise<PiQueueEditQueuedResult> {
    const key = this.options.coordinationKey ?? this.session
    const coordination = queueRecoveryByKey.get(key) ?? {
      recoveredSelectors: new Map<string, string>(),
      recoveredBlock: '',
    }
    queueRecoveryByKey.set(key, coordination)
    if (coordination.inFlight) return coordination.inFlight
    const run = this.editQueuedOnce(coordination)
    coordination.inFlight = run
    void run.finally(() => {
      if (coordination.inFlight === run) coordination.inFlight = undefined
      if (coordination.recoveredSelectors.size === 0) queueRecoveryByKey.delete(key)
    }).catch(() => {})
    return run
  }

  // Remove a single queued message from the hold queue by its clear selector.
  // Metadata-free entries have no selector and cannot be individually removed.
  async removeQueued(followUp: QueuedUserMessage): Promise<{ ok: true } | { ok: false; message: string }> {
    const selector = queueClearSelector(followUp)
    if (!selector) {
      const message = 'This queued message has no removal id. Use Edit queued to recover it instead.'
      this.options.onWarning?.(message)
      return { ok: false, message }
    }
    try {
      await this.session.clearQueue(selector)
      return { ok: true }
    } catch {
      const message = 'Could not remove the queued message. It may still send unless you retry or use Edit queued.'
      this.options.onWarning?.(message)
      return { ok: false, message }
    }
  }

  private async editQueuedOnce(coordination: QueueRecoveryCoordination): Promise<PiQueueEditQueuedResult> {
    const followUps = this.session.getState().queue.followUps
    if (followUps.length === 0) {
      const message = 'No queued messages to edit.'
      this.options.onWarning?.(message)
      return { type: 'empty', message }
    }

    const selected = followUps.map((followUp) => ({ followUp, selector: queueClearSelector(followUp) }))
    // Metadata-free queue entries have no stable per-item clear selector, so
    // selector-scoped recovery cannot address them. Fall back to the legacy
    // behavior: copy every queued message into the draft and full-clear the
    // queue in one request, instead of refusing to edit at all.
    if (selected.some((item) => !item.selector)) return this.editQueuedFallback(followUps)

    // Recover each selector exactly once before its first destructive request.
    // The coordination key survives policy/controller recreation for a session,
    // so retrying a partial clear cannot duplicate text already in the draft.
    const currentItems = new Map(selected.map((item) => [
      queueSelectorKey(item.selector!),
      item.followUp.displayText,
    ]))
    for (const [selectorKey, recoveredText] of coordination.recoveredSelectors) {
      if (currentItems.get(selectorKey) !== recoveredText) coordination.recoveredSelectors.delete(selectorKey)
    }
    const newlyRecovered = selected.filter((item) => (
      coordination.recoveredSelectors.get(queueSelectorKey(item.selector!)) !== item.followUp.displayText
    ))
    const currentDraft = this.options.getDraft?.() ?? ''
    const newBlock = newlyRecovered.map((item) => item.followUp.displayText.trim()).filter(Boolean).join('\n\n')
    const draft = newBlock && coordination.recoveredBlock && currentDraft.startsWith(coordination.recoveredBlock)
      ? `${coordination.recoveredBlock}\n\n${newBlock}${currentDraft.slice(coordination.recoveredBlock.length)}`
      : buildEditedQueuedDraft(newlyRecovered.map((item) => item.followUp), currentDraft)
    if (draft !== currentDraft) this.options.onDraftChange?.(draft)
    if (newBlock) coordination.recoveredBlock = coordination.recoveredBlock
      ? `${coordination.recoveredBlock}\n\n${newBlock}`
      : newBlock
    for (const item of newlyRecovered) {
      coordination.recoveredSelectors.set(queueSelectorKey(item.selector!), item.followUp.displayText)
    }

    let clearError: unknown
    for (const item of selected) {
      const selectorKey = queueSelectorKey(item.selector!)
      try {
        await this.session.clearQueue(item.selector!)
        coordination.recoveredSelectors.delete(selectorKey)
      } catch (error) {
        clearError = error
        break
      }
    }
    if (coordination.recoveredSelectors.size === 0) coordination.recoveredBlock = ''
    if (!clearError) return { type: 'cleared', draft }

    const message = 'Queued messages were copied into the composer, but some may remain queued. Review the queue and composer before sending.'
    this.options.onWarning?.(message)
    return { type: 'clear-failed', draft, error: clearError, message }
  }

  // Legacy path for queues that contain metadata-free entries: copy all queued
  // messages into the draft and issue a single full clear. No recovery
  // coordination is needed because the clear is all-or-nothing.
  private async editQueuedFallback(followUps: readonly QueuedUserMessage[]): Promise<PiQueueEditQueuedResult> {
    const draft = buildEditedQueuedDraft(followUps, this.options.getDraft?.() ?? '')
    this.options.onDraftChange?.(draft)
    try {
      await this.session.clearQueue()
      return { type: 'cleared', draft }
    } catch (error) {
      const message = 'Queued messages were copied into the composer, but the server queue was not cleared. They may still send unless you retry Edit queued or Stop.'
      this.options.onWarning?.(message)
      return { type: 'clear-failed', draft, error, message }
    }
  }

  interrupt(payload: InterruptPayload = {}): Promise<CommandReceipt> {
    return this.session.interrupt(payload)
  }

  resumeQueued(): Promise<CommandReceipt> {
    return this.session.interrupt({ queueAction: 'resume' })
  }

  stop(): Promise<StopReceipt> {
    return this.session.stop()
  }

  private nextFollowUpClientSeq(): number {
    const next = nextFollowUpClientSeq(this.session.getState(), this.nextClientSeqFloor)
    this.nextClientSeqFloor = next + 1
    return next
  }

  private createClientNonce(): string {
    return this.options.createClientNonce?.() ?? defaultClientNonce()
  }

  private block(reason: Extract<PiQueueSubmitResult, { type: 'blocked' }>['reason'], message: string): PiQueueSubmitResult {
    this.options.onWarning?.(message)
    return { type: 'blocked', reason, message }
  }
}

export function createPiFollowUpQueueController(
  session: PiQueueSessionLike,
  options?: PiQueueControllerOptions,
): PiFollowUpQueueController {
  return new PiFollowUpQueueController(session, options)
}

export function isPiChatBusy(status: PiChatStatus): boolean {
  return status === 'submitted' || status === 'streaming' || status === 'aborting'
}

export function canPromptDuringInitialHydration(state: PiChatState): boolean {
  return !state.hydrated
    && state.history.messageCount === 0
    && state.committedMessages.length === 0
    && state.queue.followUps.length === 0
    && Object.keys(state.optimisticOutbox).length === 0
    && !state.streamingMessage
}

function hasPendingOptimisticPromptInEmptySession(state: PiChatState): boolean {
  return state.hydrated
    && state.history.messageCount === 0
    && state.committedMessages.length === 0
    && Object.values(state.optimisticOutbox).some((message) => message.clientSeq === undefined)
}

export function nextFollowUpClientSeq(state: PiChatState, floor = 1): number {
  let maxSeq = floor - 1
  for (const queued of state.queue.followUps) {
    if (typeof queued.clientSeq === 'number') maxSeq = Math.max(maxSeq, queued.clientSeq)
  }
  for (const optimistic of Object.values(state.optimisticOutbox)) {
    if (typeof optimistic.clientSeq === 'number') maxSeq = Math.max(maxSeq, optimistic.clientSeq)
  }
  return maxSeq + 1
}

export function buildEditedQueuedDraft(followUps: readonly QueuedUserMessage[], existingDraft = ''): string {
  const queuedText = followUps.map((followUp) => followUp.displayText.trim()).filter(Boolean).join('\n\n')
  const draft = existingDraft.trim()
  if (!queuedText) return draft
  if (!draft) return queuedText
  return `${queuedText}\n\n${draft}`
}

function queueClearSelector(followUp: QueuedUserMessage): QueueClearPayload | undefined {
  if (followUp.clientNonce) {
    return {
      clientNonce: followUp.clientNonce,
      ...(followUp.clientSeq !== undefined ? { clientSeq: followUp.clientSeq } : {}),
    }
  }
  if (followUp.clientSeq !== undefined) return { clientSeq: followUp.clientSeq }
  return undefined
}

function queueSelectorKey(selector: QueueClearPayload): string {
  return `${selector.clientNonce ?? ''}:${selector.clientSeq ?? ''}`
}

function isBusySlashCommand(input: PiQueueSubmitInput): boolean {
  if (input.kind === 'expanded-text') return false
  if (input.kind === 'slash-command') return true
  return input.text.trimStart().startsWith('/')
}

function defaultClientNonce(): string {
  const crypto = globalThis.crypto as Crypto | undefined
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
