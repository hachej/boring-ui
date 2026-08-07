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
  transcript: "ask-user.v1.transcript",
} as const

export const ASK_USER_BRIDGE_CAPABILITIES = {
  request: "ask-user:request",
  answer: "ask-user:answer",
  cancel: "ask-user:cancel",
  pending: "ask-user:pending",
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

export type AskUserBridgeRequestOutput = AskUserToolResult

export type AskUserBridgeMutationOutput = {
  ok: true
  status: string
}

export type AskUserBridgeAnswerOutput = AskUserBridgeMutationOutput

export type AskUserBridgePendingOutput = {
  pending: AskUserQuestion | null
}

export type AskUserBridgeTranscriptOutput = {
  events: AskUserTranscriptEvent[]
}

