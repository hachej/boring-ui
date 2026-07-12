// Shared zod-issue -> stable-code mapping and validation-error base class.
//
// Extracted from agent-definition.ts / agent-consumption.ts (audit finding
// #4: formatPath, the zod-issue mapper, and the {code,field,validationCode}
// error shape were each duplicated per contract module). Behavior is
// unchanged: this module only relocates the existing logic. Public error
// shapes (codes/messages/details) are preserved byte-for-byte.

import { z } from 'zod'

import { ErrorCode } from './error-codes'

export interface AgentSchemaIssue<Code extends string> {
  code: Code
  field: string
  message: string
}

export type AgentSchemaValidationResult<T, Code extends string> =
  | { valid: true; value: T }
  | { valid: false; issues: AgentSchemaIssue<Code>[] }

export function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '<root>'
  return path.reduce<string>(
    (result, part) =>
      typeof part === 'number'
        ? `${result}[${part}]`
        : result.length === 0
          ? String(part)
          : `${result}.${String(part)}`,
    '',
  )
}

export function mapZodIssues<Code extends string>(
  issues: z.ZodIssue[],
  invalidCode: Code,
  unsupportedCode: Code,
): AgentSchemaIssue<Code>[] {
  return issues.flatMap((issue) => {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      const parent = formatPath(issue.path)
      return [...issue.keys].sort().map((key) => ({
        code: unsupportedCode,
        field: parent === '<root>' ? key : `${parent}.${key}`,
        message: `${key} is not supported by schema version 1`,
      }))
    }
    const field = formatPath(issue.path)
    return [{
      code: invalidCode,
      field,
      message: field === '<root>' ? issue.message : `${field} ${issue.message}`,
    }]
  })
}

export abstract class SchemaValidationError<Code extends string> extends Error {
  readonly code = ErrorCode.enum.CONFIG_INVALID
  readonly field: string
  readonly validationCode: Code

  constructor(issue: AgentSchemaIssue<Code>) {
    super(issue.message)
    this.field = issue.field
    this.validationCode = issue.code
  }
}
