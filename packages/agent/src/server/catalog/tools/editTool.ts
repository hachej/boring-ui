import type { AgentTool, ToolExecContext, ToolResult } from '../../../shared/tool'
import type { Workspace } from '../../../shared/workspace'
import {
  bytesWritten,
  type FileChangeMetadata,
  makeError,
  nowIso,
} from './_shared'

interface EditToolDetails {
  path: string
  replacements: number
  bytesWritten: number
  fileChanges: FileChangeMetadata[]
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let searchFrom = 0
  while (true) {
    const index = haystack.indexOf(needle, searchFrom)
    if (index === -1) break
    count += 1
    searchFrom = index + needle.length
  }
  return count
}

function replaceOccurrences(
  content: string,
  oldString: string,
  newString: string,
  all: boolean,
): string {
  if (all) return content.split(oldString).join(newString)
  const index = content.indexOf(oldString)
  if (index === -1) return content
  return (
    content.slice(0, index) +
    newString +
    content.slice(index + oldString.length)
  )
}

function successResult(details: EditToolDetails): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `edited ${details.path} (${details.replacements} replacement${details.replacements === 1 ? '' : 's'})`,
      },
    ],
    details,
  }
}

export function createEditTool(workspace: Workspace): AgentTool {
  return {
    name: 'edit',
    description:
      'Edit an existing file via exact string replacement with optional replaceAll behavior.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldString: { type: 'string' },
        newString: { type: 'string' },
        replaceAll: { type: 'boolean' },
      },
      required: ['path', 'oldString', 'newString'],
      additionalProperties: false,
    },
    async execute(input, ctx: ToolExecContext): Promise<ToolResult> {
      const params = input as Record<string, unknown>
      if (ctx.abortSignal.aborted) {
        return makeError('edit aborted')
      }

      if (typeof params.path !== 'string' || params.path.length === 0) {
        return makeError('path is required')
      }
      if (typeof params.oldString !== 'string' || params.oldString.length === 0) {
        return makeError('oldString must be a non-empty string')
      }
      if (typeof params.newString !== 'string') {
        return makeError('newString must be a string')
      }
      if (
        params.replaceAll !== undefined &&
        typeof params.replaceAll !== 'boolean'
      ) {
        return makeError('replaceAll must be a boolean when provided')
      }
      const path = params.path
      const oldString = params.oldString
      const newString = params.newString
      const replaceAll = params.replaceAll === true

      try {
        const originalContent = await workspace.readFile(path)
        const matches = countOccurrences(originalContent, oldString)

        if (matches === 0) {
          return makeError('oldString not found; edit requires exact existing content')
        }
        if (!replaceAll && matches > 1) {
          return makeError('ambiguous match; add context or set replaceAll=true')
        }

        const nextContent = replaceOccurrences(originalContent, oldString, newString, replaceAll)

        await workspace.writeFile(path, nextContent)
        const writtenBytes = bytesWritten(nextContent)

        return successResult({
          path,
          replacements: replaceAll ? matches : 1,
          bytesWritten: writtenBytes,
          fileChanges: [
            {
              op: 'edit',
              path,
              size: writtenBytes,
              timestamp: nowIso(),
              existsBefore: true,
            },
          ],
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error'
        return makeError(`edit failed: ${message}`)
      }
    },
  }
}
