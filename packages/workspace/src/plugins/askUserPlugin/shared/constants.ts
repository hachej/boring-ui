export const ASK_USER_PLUGIN_ID = "ask-user" as const
export const ASK_USER_PANEL_ID = "ask-user.questions" as const
export const ASK_USER_PANEL_TITLE = "Questions" as const
export const ASK_USER_SURFACE_KIND = "questions" as const

export const ASK_USER_COMMAND_KINDS = {
  SUBMIT: "questions.submit",
  CANCEL: "questions.cancel",
  OPENED: "questions.opened",
} as const

export const ASK_USER_UI_STATE_SLOTS = {
  PENDING: "questions.pending",
} as const

export const ASK_USER_SCHEMA_LIMITS = {
  maxFields: 8,
  maxOptionsPerField: 50,
  maxFieldNameLength: 64,
  maxTitleLength: 200,
  maxLabelLength: 160,
  maxHelpTextLength: 500,
  maxContextLength: 4000,
  maxSerializedSchemaBytes: 32_000,
  maxFreeformAnswerLength: 4_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 30 * 60_000,
  defaultTimeoutMs: 10 * 60_000,
} as const

export const ASK_USER_FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export const ASK_USER_RESERVED_FIELD_NAMES = new Set([
  "__proto__",
  "prototype",
  "constructor",
])
