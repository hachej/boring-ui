import type { FileSearch } from '../../../shared/file-search'
import type { AgentTool, ToolExecContext, ToolResult } from '../../../shared/tool'
import {
  DEFAULT_TOOL_LIMIT,
  makeError,
  MAX_PATTERN_LENGTH,
  MAX_TOOL_LIMIT,
  normalizeLimit,
} from './_shared'

interface FindFilesDetails {
  glob: string
  limit: number
  count: number
  files: string[]
}

function successResult(details: FindFilesDetails): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: details.files.length === 0 ? 'no files found' : details.files.join('\n'),
      },
    ],
    details,
  }
}

export function createFindFilesTool(fileSearch: FileSearch): AgentTool {
  return {
    name: 'find_files',
    description:
      'Find workspace files by glob pattern. Prefer this over shell find loops, especially in vercel-sandbox mode.',
    parameters: {
      type: 'object',
      properties: {
        glob: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_TOOL_LIMIT },
      },
      required: ['glob'],
      additionalProperties: false,
    },
    async execute(input, ctx: ToolExecContext): Promise<ToolResult> {
      const params = input as Record<string, unknown>
      const glob = params.glob
      if (typeof glob !== 'string' || glob.length === 0) {
        return makeError('glob is required')
      }
      if (glob.includes('\0')) {
        return makeError('glob must not contain null bytes')
      }
      if (glob.length > MAX_PATTERN_LENGTH) {
        return makeError(`glob exceeds ${MAX_PATTERN_LENGTH} chars`)
      }

      const { limit, error } = normalizeLimit(params.limit, {
        default: DEFAULT_TOOL_LIMIT,
        max: MAX_TOOL_LIMIT,
      })
      if (error) {
        return makeError(error)
      }

      if (ctx.abortSignal.aborted) {
        return makeError('find_files aborted')
      }

      try {
        const files = await fileSearch.search(glob, limit)
        return successResult({
          glob,
          limit,
          count: files.length,
          files,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown find_files failure'
        return makeError(`find_files failed: ${message}`)
      }
    },
  }
}
