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

function adaptPiTool(piTool: { name: string; description: string; parameters: unknown; execute: Function }): AgentTool {
  return {
    name: piTool.name,
    description: piTool.description,
    parameters: piTool.parameters as Record<string, unknown>,
    async execute(params, ctx) {
      const result = await piTool.execute(
        ctx.toolCallId,
        params,
        ctx.abortSignal,
        ctx.onUpdate
          ? (update: { content: Array<{ type: string; text: string }>; details: unknown }) => {
              const text = update.content
                .filter((c: { type: string }) => c.type === 'text')
                .map((c: { type: string; text: string }) => c.text)
                .join('')
              ctx.onUpdate!(text)
            }
          : undefined,
      )
      const textContent = (result.content ?? [])
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { type: string; text: string }) => ({ type: 'text' as const, text: c.text }))
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
