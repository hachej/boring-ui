import { chatErrorFromUnknown, type ChatError, type PiChatSnapshot, type PiChatStatus, type QueuedUserMessage } from '../../shared/chat'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from './PiAgentSessionAdapter'
import { buildPiChatHistory, type BuildPiChatHistoryOptions } from './piChatHistory'

export interface BuildPiChatSnapshotOptions {
  seq: number
  sessionId?: string
  activeTurnId?: string
  messageTurnIds?: ReadonlyMap<string, string>
  status?: PiChatStatus
  error?: ChatError
  attachmentUrl?: BuildPiChatHistoryOptions['attachmentUrl']
}

function queueId(sessionId: string, index: number, text: string): string {
  return `queue:${sessionId}:followup:${index}:${stableTextHash(text)}`
}

function stableTextHash(text: string): string {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

export function buildPiChatQueuedFollowUps(sessionId: string, followUpMessages: readonly string[]): QueuedUserMessage[] {
  return followUpMessages.map((displayText, index) => ({
    id: queueId(sessionId, index, displayText),
    kind: 'followup',
    displayText,
  }))
}

function buildFollowUpQueue(snapshot: PiAgentSessionSnapshot): QueuedUserMessage[] {
  return buildPiChatQueuedFollowUps(snapshot.sessionId, snapshot.followUpMessages)
}

function statusFromSnapshot(snapshot: PiAgentSessionSnapshot, error?: ChatError): PiChatStatus {
  if (error) return 'error'
  if (snapshot.isStreaming) return 'streaming'
  return 'idle'
}

function errorFromSnapshot(snapshot: PiAgentSessionSnapshot): ChatError | undefined {
  const state = snapshot.state
  if (typeof state !== 'object' || state === null || !('errorMessage' in state)) return undefined
  const message = (state as { errorMessage?: unknown }).errorMessage
  if (typeof message !== 'string' || message.length === 0) return undefined
  return chatErrorFromUnknown(message, 'Agent turn failed.')
}

export function buildPiChatSnapshot(adapter: PiAgentSessionAdapter, options: BuildPiChatSnapshotOptions): PiChatSnapshot {
  const piSnapshot = adapter.readSnapshot()
  const sessionId = options.sessionId ?? piSnapshot.sessionId
  const error = options.error ?? errorFromSnapshot(piSnapshot)
  const status = options.status ?? statusFromSnapshot(piSnapshot, error)

  return {
    protocolVersion: 1,
    sessionId,
    seq: options.seq,
    status,
    activeTurnId: options.activeTurnId,
    currentModel: adapter.currentModel?.(),
    messages: buildPiChatHistory(piSnapshot.messages, {
      sessionId,
      messageTurnIds: options.messageTurnIds,
      attachmentUrl: options.attachmentUrl,
    }),
    queue: { followUps: buildPiChatQueuedFollowUps(sessionId, piSnapshot.followUpMessages) },
    followUpMode: 'one-at-a-time',
    error,
  }
}
