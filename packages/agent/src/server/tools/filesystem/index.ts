import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@mariozechner/pi-coding-agent'

import type { AgentTool } from '../../../shared/tool'
import type { RuntimeBundle } from '../../runtime/mode'
import { boundFs } from '../operations/bound'
import {
  vercelEditOps,
  vercelFindOps,
  vercelLsOps,
  vercelReadOps,
  vercelWriteOps,
} from '../operations/vercel'
import { vercelGrepTool } from '../vercelGrepTool'

interface PiToolResultLike {
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

interface PiToolLike<TParams extends Record<string, unknown>> {
  name: string
  description: string
  promptSnippet?: string
  parameters: unknown
  execute(
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: ((update: PiToolResultLike) => void) | undefined,
    ctx: unknown,
  ): Promise<PiToolResultLike>
}

function isTextContent(
  content: { type: string; text?: string },
): content is { type: 'text'; text: string } {
  return content.type === 'text' && typeof content.text === 'string'
}

function adaptPiTool<TParams extends Record<string, unknown>>(
  piTool: PiToolLike<TParams>,
): AgentTool {
  return {
    name: piTool.name,
    description: piTool.description,
    promptSnippet: piTool.promptSnippet,
    parameters: piTool.parameters as Record<string, unknown>,
    async execute(params, ctx) {
      const result = await piTool.execute(
        ctx.toolCallId,
        params as TParams,
        ctx.abortSignal,
        ctx.onUpdate
          ? (update) => {
              const text = update.content
                ?.filter(isTextContent)
                .map((c) => c.text)
                .join('')
              if (text) ctx.onUpdate?.(text)
            }
          : undefined,
        {},
      )
      const textContent = (result.content ?? [])
        .filter(isTextContent)
        .map((c) => ({ type: 'text' as const, text: c.text }))
      return {
        content: textContent.length > 0 ? textContent : [{ type: 'text', text: '' }],
        isError: false,
        details: result.details,
      }
    },
  }
}

export function buildFilesystemAgentTools(bundle: RuntimeBundle): AgentTool[] {
  const cwd = bundle.workspace.root

  if (bundle.sandbox.provider === 'vercel-sandbox') {
    return [
      adaptPiTool(createReadToolDefinition(cwd, { operations: vercelReadOps(bundle.workspace) })),
      adaptPiTool(createWriteToolDefinition(cwd, { operations: vercelWriteOps(bundle.workspace) })),
      adaptPiTool(createEditToolDefinition(cwd, { operations: vercelEditOps(bundle.workspace) })),
      adaptPiTool(createFindToolDefinition(cwd, { operations: vercelFindOps(bundle.sandbox, bundle.workspace) })),
      vercelGrepTool(bundle.sandbox, cwd),
      adaptPiTool(createLsToolDefinition(cwd, { operations: vercelLsOps(bundle.workspace) })),
    ]
  }

  const ops = boundFs(cwd)
  return [
    adaptPiTool(createReadToolDefinition(cwd, { operations: ops.read })),
    adaptPiTool(createWriteToolDefinition(cwd, { operations: ops.write })),
    adaptPiTool(createEditToolDefinition(cwd, { operations: ops.edit })),
    adaptPiTool(createFindToolDefinition(cwd, { operations: ops.find })),
    adaptPiTool(createGrepToolDefinition(cwd, { operations: ops.grep })),
    adaptPiTool(createLsToolDefinition(cwd, { operations: ops.ls })),
  ]
}
