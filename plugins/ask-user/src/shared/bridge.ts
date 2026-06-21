import type {
  AskUserAnswer,
  AskUserAnswerValue,
  AskUserFormSchema,
  AskUserQuestion,
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

export type AskUserBridgePendingOutput = {
  pending: AskUserQuestion | null
}

export type AskUserBridgeTranscriptOutput = {
  events: AskUserTranscriptEvent[]
}

export type AskUserBridgeAnswerOutput = {
  status: "answered"
  answer: AskUserAnswer
}

/** @deprecated Use ASK_USER_BRIDGE_OPS. */
export const HUMAN_INPUT_OPS = ASK_USER_BRIDGE_OPS
/** @deprecated Use ASK_USER_BRIDGE_CAPABILITIES. */
export const HUMAN_INPUT_CAPABILITIES = ASK_USER_BRIDGE_CAPABILITIES

/** @deprecated Use AskUserBridgeRequestInput. */
export type HumanInputRequestInput = AskUserBridgeRequestInput
/** @deprecated Use AskUserBridgeAnswerInput. */
export type HumanInputAnswerInput = AskUserBridgeAnswerInput
/** @deprecated Use AskUserBridgeCancelInput. */
export type HumanInputCancelInput = AskUserBridgeCancelInput
/** @deprecated Use AskUserBridgePendingInput. */
export type HumanInputPendingInput = AskUserBridgePendingInput
/** @deprecated Use AskUserBridgeTranscriptInput. */
export type HumanInputTranscriptInput = AskUserBridgeTranscriptInput
/** @deprecated Use AskUserBridgeRequestOutput. */
export type HumanInputRequestOutput = AskUserBridgeRequestOutput
/** @deprecated Use AskUserBridgeMutationOutput. */
export type HumanInputMutationOutput = AskUserBridgeMutationOutput
/** @deprecated Use AskUserBridgePendingOutput. */
export type HumanInputPendingOutput = AskUserBridgePendingOutput
/** @deprecated Use AskUserBridgeTranscriptOutput. */
export type HumanInputTranscriptOutput = AskUserBridgeTranscriptOutput
/** @deprecated Use AskUserBridgeAnswerOutput. */
export type HumanInputAnswerOutput = AskUserBridgeAnswerOutput
