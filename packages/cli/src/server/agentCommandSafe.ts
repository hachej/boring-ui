import type { AgentCommandDeps } from "./agentCommandDeps.js"

export interface AgentCliErrorV1 {
  schemaVersion: 1
  ok: false
  error: {
    code: string
    field?: string
    message: string
  }
}

export class AgentValidateCliError extends Error {
  readonly code: string
  readonly field?: string

  constructor(input: { code: string; field?: string; message: string }) {
    super(input.message)
    this.name = "AgentValidateCliError"
    this.code = input.code
    if (input.field !== undefined) this.field = input.field
  }
}

export function escapeTerminalUnsafeCharacter(value: string): string {
  return value.replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

export function safeHumanValue(value: string): string {
  return escapeTerminalUnsafeCharacter(value)
}

export function safeHumanJsonValue(value: string): string {
  return escapeTerminalUnsafeCharacter(JSON.stringify(value))
}

export function stableAgentCliError(
  code: string,
  field: string | undefined,
  message: string,
): AgentValidateCliError {
  return new AgentValidateCliError({
    code,
    ...(field === undefined ? {} : { field }),
    message,
  })
}

export function toAgentCliError(error: unknown, deps?: AgentCommandDeps): AgentCliErrorV1 {
  if (error instanceof AgentValidateCliError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.code,
        ...(error.field === undefined ? {} : { field: error.field }),
        message: error.message,
      },
    }
  }
  if (deps !== undefined && error instanceof deps.AgentDirectoryCompilerError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.compilerCode,
        field: error.field,
        message: error.message,
      },
    }
  }
  if (deps !== undefined && error instanceof deps.AgentDefinitionValidationError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.validationCode,
        field: error.field,
        message: error.message,
      },
    }
  }
  if (deps !== undefined && error instanceof deps.AuthoredAgentMaterializationError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.code,
        ...(error.field === undefined ? {} : { field: error.field }),
        message: error.message,
      },
    }
  }
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "agent validation failed",
    },
  }
}
