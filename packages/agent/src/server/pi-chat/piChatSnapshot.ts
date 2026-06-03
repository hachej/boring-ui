import { ErrorCode } from '../../shared/error-codes'
import type { ChatError, PiChatSnapshot, PiChatStatus, QueuedUserMessage } from '../../shared/chat'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from './PiAgentSessionAdapter'
import { buildPiChatHistory } from './piChatHistory'

export interface BuildPiChatSnapshotOptions {
  seq: number
  activeTurnId?: string
  status?: PiChatStatus
  error?: ChatError
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

function buildFollowUpQueue(snapshot: PiAgentSessionSnapshot): QueuedUserMessage[] {
  return snapshot.followUpMessages.map((displayText, index) => ({
    id: queueId(snapshot.sessionId, index, displayText),
    kind: 'followup',
    displayText,
  }))
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
  return {
    code: ErrorCode.enum.INTERNAL_ERROR,
    message,
    retryable: false,
  }
}

export function buildPiChatSnapshot(adapter: PiAgentSessionAdapter, options: BuildPiChatSnapshotOptions): PiChatSnapshot {
  const piSnapshot = adapter.readSnapshot()
  const error = options.error ?? errorFromSnapshot(piSnapshot)
  const status = options.status ?? statusFromSnapshot(piSnapshot, error)

  return {
    protocolVersion: 1,
    sessionId: piSnapshot.sessionId,
    seq: options.seq,
    status,
    activeTurnId: options.activeTurnId,
    messages: buildPiChatHistory(piSnapshot.messages, {
      sessionId: piSnapshot.sessionId,
      turnId: options.activeTurnId,
    }),
    queue: { followUps: buildFollowUpQueue(piSnapshot) },
    followUpMode: 'one-at-a-time',
    error,
  }
}
