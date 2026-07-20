import type { ToolUiMetadata } from '../tool-ui'

export type BoringChatMessageRole = 'user' | 'assistant' | 'system'

export type BoringChatMessageStatus = 'pending' | 'streaming' | 'done' | 'aborted' | 'error'
export type BoringChatRunTerminalState = 'success' | 'error' | 'aborted' | 'interrupted'

export type BoringChatReasoningState = 'streaming' | 'done'

export type BoringChatToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'aborted'

export type BoringChatPart =
  | { type: 'text'; id?: string; text: string }
  | { type: 'reasoning'; id: string; text: string; state?: BoringChatReasoningState }
  | {
      type: 'tool-call'
      id: string
      toolName: string
      input?: unknown
      state: BoringChatToolState
      output?: unknown
      errorText?: string
      ui?: ToolUiMetadata
    }
  | { type: 'file'; id?: string; filename?: string; mediaType?: string; url?: string; path?: string; filesystem?: string }
  | { type: 'notice'; id?: string; level: 'info' | 'warning' | 'error'; text: string }

export interface BoringChatMessage {
  id: string
  role: BoringChatMessageRole
  status?: BoringChatMessageStatus
  parts: BoringChatPart[]
  createdAt?: string
  clientNonce?: string
  clientSeq?: number
  piEntryId?: string
  turnId?: string
  /** Authoritative native terminal state; absent on intermediate tool-use messages. */
  runTerminalState?: BoringChatRunTerminalState
}
