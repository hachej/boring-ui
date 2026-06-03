import type {
  ChatAttachmentPayload,
  FollowUpPayload,
  PiChatStatus,
  PromptPayload,
  QueuedUserMessage,
} from '../../../shared/chat'
import type { PiChatState } from './piChatReducer'

export interface PiQueueSessionLike {
  getState(): PiChatState
  prompt(payload: PromptPayload): Promise<unknown>
  followUp(payload: FollowUpPayload): Promise<unknown>
  clearQueue(): Promise<unknown>
  interrupt(): Promise<unknown>
  stop(): Promise<unknown>
}

export interface PiQueueSubmitInput {
  text: string
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
}

export type PiQueueSubmitResult =
  | { type: 'prompt'; clientNonce: string }
  | { type: 'followup'; clientNonce: string; clientSeq: number }
  | { type: 'blocked'; reason: 'empty' | 'hydrating' | 'busy-attachments' | 'busy-slash-command'; message: string }

export type PiQueueEditQueuedResult =
  | { type: 'cleared'; draft: string }
  | { type: 'empty'; message: string }
  | { type: 'clear-failed'; draft: string; error: unknown; message: string }

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
    if (state.status === 'hydrating') {
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
      await this.session.followUp({ message: text, clientNonce, clientSeq })
      return { type: 'followup', clientNonce, clientSeq }
    }

    const clientNonce = this.createClientNonce()
    await this.session.prompt({
      message: text,
      clientNonce,
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    })
    return { type: 'prompt', clientNonce }
  }

  async editQueued(): Promise<PiQueueEditQueuedResult> {
    const followUps = this.session.getState().queue.followUps
    if (followUps.length === 0) {
      const message = 'No queued messages to edit.'
      this.options.onWarning?.(message)
      return { type: 'empty', message }
    }

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

  interrupt(): Promise<unknown> {
    return this.session.interrupt()
  }

  stop(): Promise<unknown> {
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
