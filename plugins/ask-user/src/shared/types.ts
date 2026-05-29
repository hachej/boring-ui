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
  timeoutMs?: number
}

export type AskUserToolInput = {
  title: string
  context?: string
  schema: AskUserFormSchema
  timeoutMs?: number
}

export type AskUserQuestionStatus = "ready" | "answered" | "cancelled" | "abandoned" | "timed_out" | "ui_unavailable"

export type AskUserQuestion = {
  questionId: string
  sessionId: string
  ownerPrincipalId: string
  status: AskUserQuestionStatus
  title?: string
  context?: string
  schema?: AskUserFormSchema
  nonce: string
  createdAt: string
  updatedAt: string
}

export type AskUserAnswerValue = string | string[] | boolean | number | null

export type AskUserAnswer = {
  questionId: string
  sessionId: string
  values: Record<string, AskUserAnswerValue>
  submittedAt: string
}

export type AskUserCancelReason =
  | "user_cancelled"
  | "timeout"
  | "aborted"
  | "ui_unavailable"
  | "abandoned"
  | "rate_limited"
  | "runtime_unavailable"

export type AskUserToolResult =
  | { status: "answered"; answer: AskUserAnswer }
  | {
      status: "cancelled"
      questionId: string
      sessionId: string
      reason: AskUserCancelReason
    }

