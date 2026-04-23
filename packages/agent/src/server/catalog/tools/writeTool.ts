import { dirname } from 'node:path'

import type { AgentTool, ToolExecContext, ToolResult } from '../../../shared/tool'
import type { Workspace } from '../../../shared/workspace'

interface WriteToolDetails {
  path: string
  bytesWritten: number
}

interface WriteParams {
  path?: unknown
  content?: unknown
  createDirs?: unknown
}

function makeError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function getParentDir(relPath: string): string | null {
  const parent = dirname(relPath)
  if (parent === '.' || parent === '') return null
  return parent
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as { code?: string }).code
  return code === 'ENOENT'
}

async function ensureParentDir(
  workspace: Workspace,
  path: string,
  createDirs: boolean,
): Promise<void> {
  const parentDir = getParentDir(path)
  if (!parentDir) return

  try {
    const parentStat = await workspace.stat(parentDir)
    if (parentStat.kind !== 'dir') {
      throw new Error('parent path is not a directory')
    }
    return
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    if (!createDirs) {
      throw new Error('parent directory does not exist')
    }
    await workspace.mkdir(parentDir, { recursive: true })
  }
}

function makeTmpPath(targetPath: string, toolCallId: string): string {
  const safeToolCallId = toolCallId.replace(/[^A-Za-z0-9_-]/g, '_') || 'tool'
  const suffix = `${Date.now().toString(36)}-${safeToolCallId}`
  return `${targetPath}.tmp-${suffix}`
}

function bytesWritten(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

function successResult(details: WriteToolDetails): ToolResult {
  return {
    content: [{ type: 'text', text: `wrote ${details.bytesWritten} bytes to ${details.path}` }],
    details,
  }
}

export function createWriteTool(workspace: Workspace): AgentTool {
  return {
    name: 'write',
    description:
      'Write file content atomically with optional parent directory creation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        createDirs: { type: 'boolean' },
      },
      required: ['path', 'content'],
    },
    async execute(input, ctx: ToolExecContext): Promise<ToolResult> {
      const params = input as WriteParams
      if (typeof params.path !== 'string' || params.path.length === 0) {
        return makeError('path is required')
      }
      if (typeof params.content !== 'string') {
        return makeError('content must be a string')
      }
      if (
        params.createDirs !== undefined &&
        typeof params.createDirs !== 'boolean'
      ) {
        return makeError('createDirs must be a boolean when provided')
      }
      if (ctx.abortSignal.aborted) {
        return makeError('write aborted')
      }

      const path = params.path
      const content = params.content
      const createDirs = params.createDirs === true
      const tmpPath = makeTmpPath(path, ctx.toolCallId)

      let tmpWritten = false
      let renamed = false
      try {
        await ensureParentDir(workspace, path, createDirs)
        await workspace.writeFile(tmpPath, content)
        tmpWritten = true
        if (ctx.abortSignal.aborted) {
          return makeError('write aborted')
        }
        await workspace.rename(tmpPath, path)
        renamed = true
        return successResult({
          path,
          bytesWritten: bytesWritten(content),
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown write failure'
        return makeError(`write failed: ${message}`)
      } finally {
        if (tmpWritten && !renamed) {
          try {
            await workspace.unlink(tmpPath)
          } catch {
            // tmp may have been renamed away already.
          }
        }
      }
    },
  }
}
