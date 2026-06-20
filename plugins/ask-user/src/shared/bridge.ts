import type {
  AskUserAnswer,
  AskUserAnswerValue,
  AskUserFormSchema,
  AskUserQuestion,
  AskUserToolResult,
  AskUserTranscriptEvent,
} from "./types"

export const HUMAN_INPUT_OPS = {
  request: "human-input.v1.request",
  answer: "human-input.v1.answer",
  cancel: "human-input.v1.cancel",
  pending: "human-input.v1.pending",
  transcript: "human-input.v1.transcript",
} as const

export const HUMAN_INPUT_CAPABILITIES = {
  request: "human-input:request",
  answer: "human-input:answer",
  cancel: "human-input:cancel",
  pending: "human-input:pending",
  transcriptRead: "human-input:transcript.read",
} as const

export type HumanInputRequestInput = {
  sessionId: string
  title?: string
  context?: string
  schema: AskUserFormSchema
  timeoutMs?: number
}

export type HumanInputAnswerInput = {
  questionId: string
  sessionId: string
  answerToken: string
  values: Record<string, AskUserAnswerValue>
}

export type HumanInputCancelInput = {
  questionId: string
  sessionId: string
  answerToken: string
}

export type HumanInputPendingInput = {
  sessionId: string
}

export type HumanInputTranscriptInput = {
  sessionId: string
}

export type HumanInputRequestOutput = AskUserToolResult

export type HumanInputMutationOutput = {
  ok: true
  status: string
}

export type HumanInputPendingOutput = {
  pending: AskUserQuestion | null
}

export type HumanInputTranscriptOutput = {
  events: AskUserTranscriptEvent[]
}

export type HumanInputAnswerOutput = {
  status: "answered"
  answer: AskUserAnswer
}
