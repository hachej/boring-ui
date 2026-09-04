import type {
  AskUserAnswerValue,
  AskUserFormSchema,
  AskUserQuestion,
  AskUserRequest,
  AskUserToolResult,
  AskUserTranscriptEvent,
} from "./types"

export const ASK_USER_BRIDGE_OPS = {
  request: "ask-user.v1.request",
  answer: "ask-user.v1.answer",
  cancel: "ask-user.v1.cancel",
  pending: "ask-user.v1.pending",
  pendingAll: "ask-user.v1.pending-all",
  transcript: "ask-user.v1.transcript",
} as const

export const ASK_USER_BRIDGE_CAPABILITIES = {
  request: "ask-user:request",
  answer: "ask-user:answer",
  cancel: "ask-user:cancel",
  pending: "ask-user:pending",
  pendingAll: "ask-user:pending-all",
  transcriptRead: "ask-user:transcript.read",
} as const

export type AskUserBridgeRequestInput = {
  sessionId: string
  title?: string
  context?: string
  schema: AskUserFormSchema
  artifacts?: AskUserRequest["artifacts"]
  timeoutMs?: number
}

export type AskUserBridgeAnswerInput = {
  questionId: string
  sessionId: string
  answerToken: string
  values: Record<string, AskUserAnswerValue>
}

export type AskUserBridgeCancelInput = {
  questionId: string
  sessionId: string
  answerToken: string
}

export type AskUserBridgePendingInput = {
  sessionId: string
}

export type AskUserBridgeTranscriptInput = {
  sessionId: string
}

/** Workspace-wide read: no session scope, because the Inbox is one owner queue
 * across every agent session, not a per-chat view. */
export type AskUserBridgePendingAllInput = Record<string, never>

/** Answer tokens stay out of the workspace-wide listing: the Inbox only needs
 * to show and route to a question, and answering re-reads the owning session's
 * `pending` payload (which carries the token) before it mutates anything. */
export type AskUserPendingSummary = {
  questionId: string
  sessionId: string
  toolCallId?: string
  status: AskUserQuestion["status"]
  title?: string
  context?: string
  artifacts: AskUserQuestion["artifacts"]
  createdAt: string
  updatedAt: string
}

export type AskUserBridgeRequestOutput = AskUserToolResult

export type AskUserBridgeMutationOutput = {
  ok: true
  status: string
}

export type AskUserBridgeAnswerOutput = AskUserBridgeMutationOutput

export type AskUserBridgePendingOutput = {
  pending: AskUserQuestion | null
}

export type AskUserBridgePendingAllOutput = {
  pending: AskUserPendingSummary[]
}

export type AskUserBridgeTranscriptOutput = {
  events: AskUserTranscriptEvent[]
}

