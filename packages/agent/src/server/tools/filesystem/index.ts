import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@mariozechner/pi-coding-agent'

import type { AgentTool } from '../../../shared/tool'
import { getRuntimeBundleStorageRoot, type RuntimeBundle, type RuntimeFilesystemStrategy } from '../../runtime/mode'
import { boundFs } from '../operations/bound'
import { buildRemoteWorkspaceFilesystemAgentTools } from './remoteWorkspaceTools'

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

function defaultFilesystemStrategyForBundle(bundle: RuntimeBundle): RuntimeFilesystemStrategy {
  return bundle.sandbox.placement === 'remote'
    ? { kind: 'remote-workspace' }
    : { kind: 'host' }
}

export function buildFilesystemAgentTools(bundle: RuntimeBundle): AgentTool[] {
  const cwd = bundle.workspace.root
  const strategy = bundle.filesystem ?? defaultFilesystemStrategyForBundle(bundle)

  if (strategy.kind === 'remote-workspace') {
    return buildRemoteWorkspaceFilesystemAgentTools(bundle, strategy.pathOptions)
  }

  const storageRoot = getRuntimeBundleStorageRoot(bundle)
  const ops = boundFs(storageRoot, { runtimeRoot: cwd })
  return [
    adaptPiTool(createReadToolDefinition(cwd, { operations: ops.read })),
    adaptPiTool(createWriteToolDefinition(cwd, { operations: ops.write })),
    adaptPiTool(createEditToolDefinition(cwd, { operations: ops.edit })),
    adaptPiTool(createFindToolDefinition(cwd, { operations: ops.find })),
    adaptPiTool(createGrepToolDefinition(cwd, { operations: ops.grep })),
    adaptPiTool(createLsToolDefinition(cwd, { operations: ops.ls })),
  ]
}
