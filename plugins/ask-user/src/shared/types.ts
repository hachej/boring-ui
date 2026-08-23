import type { HumanArtifact } from "@hachej/boring-workspace/shared"
import type { ASK_USER_CANCEL_REASONS, ASK_USER_COMMAND_KINDS, ASK_USER_QUESTION_STATUSES } from "./constants"
import type { AskUserRiskTier } from "./constants"

export type AskUserOption = {
  value: string
  label: string
  description?: string
}

export type AskUserField =
  | {
      type: "text"
      name: string
      label: string
      required?: boolean
      placeholder?: string
      defaultValue?: string
      helpText?: string
      minLength?: number
      maxLength?: number
      pattern?: string
    }
  | {
      type: "textarea"
      name: string
      label: string
      required?: boolean
      placeholder?: string
      defaultValue?: string
      helpText?: string
      minLength?: number
      maxLength?: number
    }
  | {
      type: "select"
      name: string
      label: string
      required?: boolean
      options: AskUserOption[]
      defaultValue?: string
      helpText?: string
    }
  | {
      type: "multiselect"
      name: string
      label: string
      required?: boolean
      options: AskUserOption[]
      defaultValue?: string[]
      helpText?: string
      minSelections?: number
      maxSelections?: number
    }
  | {
      type: "checkbox"
      name: string
      label: string
      defaultValue?: boolean
      helpText?: string
    }
  | {
      type: "radio"
      name: string
      label: string
      required?: boolean
      options: AskUserOption[]
      defaultValue?: string
      helpText?: string
    }
  | {
      type: "number"
      name: string
      label: string
      required?: boolean
      defaultValue?: number
      placeholder?: string
      helpText?: string
      min?: number
      max?: number
      step?: number
      integer?: boolean
    }

export type AskUserFormSchema = {
  wireVersion: 1
  fields: AskUserField[]
  submitLabel?: string
}

export type AskUserRequest = {
  sessionId: string
  title?: string
  context?: string
  schema?: AskUserFormSchema
  artifacts?: HumanArtifact[]
  timeoutMs?: number
  /** Pi tool-call correlation for the inline transcript renderer. */
  toolCallId?: string
  /** Trusted server/runtime attribution. Not accepted from browser bridge inputs. */
  ownerPrincipalId?: string
  /** Declared decision risk tier for this question, if any (#1348 follow-up decision record). */
  riskTier?: AskUserRiskTier
}

export type AskUserToolInput = {
  title: string
  context?: string
  schema: AskUserFormSchema
  artifacts?: HumanArtifact[]
  timeoutMs?: number
  /** Declared decision risk tier for this question, if any. */
  riskTier?: AskUserRiskTier
}

export type AskUserQuestionStatus = (typeof ASK_USER_QUESTION_STATUSES)[number]

export type AskUserQuestion = {
  questionId: string
  sessionId: string
  /** Optional so persisted questions created before #1086 remain readable. */
  toolCallId?: string
  ownerPrincipalId: string
  status: AskUserQuestionStatus
  title?: string
  context?: string
  schema?: AskUserFormSchema
  artifacts: HumanArtifact[]
  answerToken: string
  createdAt: string
  updatedAt: string
  /** Declared decision risk tier; optional for pre-decision-record questions. */
  riskTier?: AskUserRiskTier
  /**
   * Absolute expiry persisted at creation time when the caller passed
   * timeoutMs. Enforced on answer and reconciled on startup so a restart
   * before the deadline cannot leave a question answerable indefinitely.
   */
  expiresAt?: string
}

export type AskUserAnswerValue = string | string[] | boolean | number | null

export type AskUserAnswer = {
  questionId: string
  sessionId: string
  values: Record<string, AskUserAnswerValue>
  submittedAt: string
  /** Snapshot of the question's declared risk tier, if any. Optional so persisted pre-decision-record answers still parse. */
  riskTier?: AskUserRiskTier
  /** Principal that resolved the question (e.g. the browser owner), when known. */
  resolvedBy?: string
}

/**
 * Thin durable decision record for a resolved question (#1348 follow-up).
 * Purely additive over stored answers — old records without the optional
 * fields still parse and yield a record with those fields absent.
 *
 * Interim, owner-approved capture only (owner ruling, 2026-08-22: no new
 * Action entity, no RBAC here) — not a general-purpose durable decision
 * primitive. It intentionally has no request identity, denial semantics, or
 * approval-authority model of its own. The ratified C5 plan's
 * tool-independent durable pause mechanism is the intended home for that
 * responsibility, and `ask-user` is expected to be absorbed into it; do not
 * extend this shape beyond the thin #1348 need before then.
 */
export type AskUserDecisionRecord = {
  questionId: string
  sessionId: string
  title?: string
  /** Exact answered payload as submitted. */
  values: Record<string, AskUserAnswerValue>
  riskTier?: AskUserRiskTier
  resolvedAt: string
  resolvedBy?: string
}

export type AskUserCancelReason = (typeof ASK_USER_CANCEL_REASONS)[number]

export type AskUserToolResult =
  | { status: "answered"; answer: AskUserAnswer }
  | {
      status: "cancelled"
      questionId: string
      sessionId: string
      reason: AskUserCancelReason
    }

export type QuestionsSubmitCommand = {
  kind: typeof ASK_USER_COMMAND_KINDS.SUBMIT
  params: {
    questionId: string
    sessionId: string
    answerToken: string
    values: Record<string, AskUserAnswerValue>
  }
}

export type QuestionsCancelCommand = {
  kind: typeof ASK_USER_COMMAND_KINDS.CANCEL
  params: {
    questionId: string
    sessionId: string
    answerToken: string
  }
}


export type QuestionsCommand = QuestionsSubmitCommand | QuestionsCancelCommand

export type AskUserTranscriptEvent =
  | {
      type: "created"
      question: AskUserQuestion
      at: string
    }
  | {
      type: "ready"
      questionId: string
      sessionId: string
      schema: AskUserFormSchema
      at: string
    }
  | {
      type: "answered"
      answer: AskUserAnswer
      at: string
    }
  | {
      type: "cancelled"
      questionId: string
      sessionId: string
      reason: AskUserCancelReason
      at: string
    }
  | {
      type: "abandoned"
      questionId: string
      sessionId: string
      at: string
    }
  | {
      type: "restored"
      questionId: string
      sessionId: string
      at: string
    }
