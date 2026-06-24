import {
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@mariozechner/pi-coding-agent'

import type { AgentTool } from '../../../shared/tool'
import type { RuntimeBundle } from '../../runtime/mode'
import {
  remoteWorkspaceEditOps,
  remoteWorkspaceFindOps,
  remoteWorkspaceLsOps,
  type RemoteWorkspacePathOptions,
  remoteWorkspaceReadOps,
  remoteWorkspaceWriteOps,
} from '../operations/remoteWorkspace'
import { remoteWorkspaceGrepTool } from '../remoteWorkspaceGrepTool'

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
    readinessRequirements: ['workspace-fs'],
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

export function buildRemoteWorkspaceFilesystemAgentTools(
  bundle: RuntimeBundle,
  pathOptions?: RemoteWorkspacePathOptions,
): AgentTool[] {
  const cwd = bundle.workspace.root
  return [
    adaptPiTool(createReadToolDefinition(cwd, { operations: remoteWorkspaceReadOps(bundle.workspace, pathOptions) })),
    adaptPiTool(createWriteToolDefinition(cwd, { operations: remoteWorkspaceWriteOps(bundle.workspace, pathOptions) })),
    adaptPiTool(createEditToolDefinition(cwd, { operations: remoteWorkspaceEditOps(bundle.workspace, pathOptions) })),
    adaptPiTool(createFindToolDefinition(cwd, { operations: remoteWorkspaceFindOps(bundle.sandbox, bundle.workspace, pathOptions) })),
    { ...remoteWorkspaceGrepTool(bundle.sandbox, cwd, pathOptions), readinessRequirements: ['workspace-fs'] },
    adaptPiTool(createLsToolDefinition(cwd, { operations: remoteWorkspaceLsOps(bundle.workspace, pathOptions) })),
  ]
}
