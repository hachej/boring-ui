import type {
  ChatAttachmentPayload,
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptReceipt,
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
  interrupt(): Promise<InterruptReceipt>
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
}

export type PiQueueSubmitResult =
  | { type: 'prompt'; clientNonce: string; cursor?: number }
  | { type: 'followup'; clientNonce: string; clientSeq: number; cursor?: number }
  | { type: 'blocked'; reason: 'empty' | 'hydrating' | 'busy-attachments' | 'busy-slash-command'; message: string }

export type PiQueueEditQueuedResult =
  | { type: 'cleared'; draft: string }
  | { type: 'empty'; message: string }
  | { type: 'clear-failed'; draft: string; error: unknown; message: string }

const editQueuedInFlight = new WeakMap<PiQueueSessionLike, Promise<PiQueueEditQueuedResult>>()
const recoveredQueueSelectors = new WeakMap<PiQueueSessionLike, Set<string>>()

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
    const active = editQueuedInFlight.get(this.session)
    if (active) return active
    const run = this.editQueuedOnce()
    editQueuedInFlight.set(this.session, run)
    void run.finally(() => {
      if (editQueuedInFlight.get(this.session) === run) editQueuedInFlight.delete(this.session)
    }).catch(() => {})
    return run
  }

  private async editQueuedOnce(): Promise<PiQueueEditQueuedResult> {
    const followUps = this.session.getState().queue.followUps
    if (followUps.length === 0) {
      const message = 'No queued messages to edit.'
      this.options.onWarning?.(message)
      return { type: 'empty', message }
    }

    const selected = followUps.map((followUp) => ({ followUp, selector: queueClearSelector(followUp) }))
    const unselectable = selected.find((item) => !item.selector)
    if (unselectable) {
      const error = new Error('Queued message lacks a stable clear selector.')
      const draft = this.options.getDraft?.() ?? ''
      const message = 'Queued messages were not cleared, so the composer was left unchanged. Retry Edit queued.'
      this.options.onWarning?.(message)
      return { type: 'clear-failed', draft, error, message }
    }

    // Recover the complete snapshot synchronously before the first destructive
    // request. This keeps typed content in the originating composer even if the
    // user switches sessions or a clear commits but its receipt is lost.
    const recovered = recoveredQueueSelectors.get(this.session) ?? new Set<string>()
    recoveredQueueSelectors.set(this.session, recovered)
    const currentKeys = new Set(selected.map((item) => queueSelectorKey(item.selector!)))
    for (const key of recovered) {
      if (!currentKeys.has(key)) recovered.delete(key)
    }
    const newlyRecovered = selected.filter((item) => !recovered.has(queueSelectorKey(item.selector!)))
    const currentDraft = this.options.getDraft?.() ?? ''
    const draft = buildEditedQueuedDraft(newlyRecovered.map((item) => item.followUp), currentDraft)
    if (draft !== currentDraft) this.options.onDraftChange?.(draft)
    for (const item of newlyRecovered) recovered.add(queueSelectorKey(item.selector!))

    let clearError: unknown
    for (const item of selected) {
      const key = queueSelectorKey(item.selector!)
      try {
        await this.session.clearQueue(item.selector!)
        recovered.delete(key)
      } catch (error) {
        clearError = error
        break
      }
    }
    if (recovered.size === 0) recoveredQueueSelectors.delete(this.session)
    if (!clearError) return { type: 'cleared', draft }

    const message = 'Queued messages were copied into the composer, but some may remain queued. Retry Edit queued.'
    this.options.onWarning?.(message)
    return { type: 'clear-failed', draft, error: clearError, message }
  }

  interrupt(): Promise<CommandReceipt> {
    return this.session.interrupt()
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
