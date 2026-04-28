import type { AgentTool, ToolExecContext, ToolResult } from '../../../shared/tool'
import type { Workspace } from '../../../shared/workspace'
import { makeError } from './_shared'

interface ReadToolDetails {
  content: string
  totalLines: number
  linesReturned: number
}

const DEFAULT_LINE_OFFSET = 1

function parsePositiveInteger(
  value: unknown,
  field: 'lineOffset' | 'lineCount',
): { value: number | null; error?: string } {
  if (value === undefined) return { value: null }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return {
      value: null,
      error: `${field} must be a positive integer`,
    }
  }
  return { value }
}

function splitLines(content: string): string[] {
  if (content.length === 0) return []
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function selectLineSlice(
  lines: string[],
  lineOffset: number | null,
  lineCount: number | null,
): string[] {
  const start = (lineOffset ?? DEFAULT_LINE_OFFSET) - 1
  if (start >= lines.length) return []
  const end = lineCount === null ? undefined : start + lineCount
  return lines.slice(start, end)
}

function buildSuccessResult(details: ReadToolDetails): ToolResult {
  return {
    content: [{ type: 'text', text: details.content }],
    details,
  }
}

export function createReadTool(workspace: Workspace): AgentTool {
  return {
    name: 'read',
    description:
      'Read a file, optionally returning a 1-indexed line slice via lineOffset and lineCount.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        lineOffset: { type: 'integer', minimum: 1 },
        lineCount: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(input, ctx: ToolExecContext): Promise<ToolResult> {
      const params = input as Record<string, unknown>
      if (ctx.abortSignal.aborted) {
        return makeError('read aborted')
      }

      const path = params.path
      if (typeof path !== 'string' || path.length === 0) {
        return makeError('path is required')
      }

      const lineOffsetResult = parsePositiveInteger(
        params.lineOffset,
        'lineOffset',
      )
      if (lineOffsetResult.error) {
        return makeError(lineOffsetResult.error)
      }

      const lineCountResult = parsePositiveInteger(params.lineCount, 'lineCount')
      if (lineCountResult.error) {
        return makeError(lineCountResult.error)
      }

      try {
        const fileContent = await workspace.readFile(path)
        const lines = splitLines(fileContent)
        const selectedLines = selectLineSlice(
          lines,
          lineOffsetResult.value,
          lineCountResult.value,
        )
        const content = selectedLines.join('\n')

        return buildSuccessResult({
          content,
          totalLines: lines.length,
          linesReturned: selectedLines.length,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error'
        if (message.includes('ENOENT')) {
          return makeError('file not found')
        }
        return makeError(`read failed: ${message}`)
      }
    },
  }
}
