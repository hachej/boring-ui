import {
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
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
  parameters: unknown
  execute(
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (update: PiToolResultLike) => void,
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
      adaptPiTool(createReadTool(cwd, { operations: vercelReadOps(bundle.workspace) })),
      adaptPiTool(createWriteTool(cwd, { operations: vercelWriteOps(bundle.workspace) })),
      adaptPiTool(createEditTool(cwd, { operations: vercelEditOps(bundle.workspace) })),
      adaptPiTool(createFindTool(cwd, { operations: vercelFindOps(bundle.sandbox) })),
      vercelGrepTool(bundle.sandbox),
      adaptPiTool(createLsTool(cwd, { operations: vercelLsOps(bundle.workspace) })),
    ]
  }

  const ops = boundFs(cwd)
  return [
    adaptPiTool(createReadTool(cwd, { operations: ops.read })),
    adaptPiTool(createWriteTool(cwd, { operations: ops.write })),
    adaptPiTool(createEditTool(cwd, { operations: ops.edit })),
    adaptPiTool(createFindTool(cwd)),
    adaptPiTool(createGrepTool(cwd)),
    adaptPiTool(createLsTool(cwd, { operations: ops.ls })),
  ]
}
