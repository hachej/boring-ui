import {
  type BashSpawnHook,
  type BashToolOptions,
  createBashToolDefinition,
  createLocalBashOperations,
} from '@mariozechner/pi-coding-agent'

import type { Sandbox } from '../../../shared/sandbox'
import type { AgentTool, ToolResult } from '../../../shared/tool'
import { getRuntimeBundleStorageRoot, type RuntimeBundle } from '../../runtime/mode'
import { buildBwrapArgs } from '../../sandbox/bwrap/buildBwrapArgs'
import { withWorkspacePythonEnv } from '../../sandbox/workspacePythonEnv'
import { vercelBashOps } from '../operations/vercel'

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

export function bwrapSpawnHook(workspaceRoot: string): BashSpawnHook {
  const args = buildBwrapArgs(workspaceRoot)
  const bwrapPrefix = ['bwrap', ...args].map(shellEscape).join(' ')
  return (context) => ({
    ...context,
    cwd: workspaceRoot,
    command: `${bwrapPrefix} bash -lc ${shellEscape(context.command)}`,
    env: withWorkspacePythonEnv({
      workspaceRoot,
      env: context.env,
      sandboxRoot: '/workspace',
    }),
  })
}

function directSpawnHook(workspaceRoot: string): BashSpawnHook {
  return (context) => ({
    ...context,
    env: withWorkspacePythonEnv({ workspaceRoot, env: context.env }),
  })
}

function bashOptionsForMode(bundle: RuntimeBundle): BashToolOptions {
  const storageRoot = getRuntimeBundleStorageRoot(bundle)
  switch (bundle.sandbox.provider) {
    case 'vercel-sandbox':
      return { operations: vercelBashOps(bundle.sandbox) }
    case 'bwrap':
      return {
        operations: createLocalBashOperations(),
        spawnHook: bwrapSpawnHook(storageRoot),
      }
    default:
      return {
        operations: createLocalBashOperations(),
        spawnHook: directSpawnHook(storageRoot),
      }
  }
}

function adaptPiTool(piTool: ReturnType<typeof createBashToolDefinition>): AgentTool {
  return {
    name: piTool.name,
    description: piTool.description,
    promptSnippet: piTool.promptSnippet,
    parameters: piTool.parameters as Record<string, unknown>,
    async execute(params, ctx) {
      const result = await piTool.execute(
        ctx.toolCallId,
        params as any,
        ctx.abortSignal,
        ctx.onUpdate
          ? (update) => {
              const text = update.content
                .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map((c) => c.text)
                .join('')
              ctx.onUpdate!(text)
            }
          : undefined,
        {} as never,
      )
      const textContent = (result.content ?? [])
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text }))
      return {
        content: textContent.length > 0 ? textContent : [{ type: 'text', text: '' }],
        isError: false,
        details: result.details,
      }
    },
  }
}

function createExecuteIsolatedCodeTool(sandbox: Sandbox): AgentTool {
  return {
    name: 'execute_isolated_code',
    description: 'Execute code in an isolated sandbox environment.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        language: { type: 'string', enum: ['python', 'shell'] },
        image: { type: 'string' },
        packages: { type: 'array', items: { type: 'string' } },
        sandboxId: { type: 'string' },
        vmSize: { type: 'string', enum: ['xxs', 'xs', 's', 'm', 'l'] },
      },
      required: ['code', 'language'],
      additionalProperties: false,
    },
    async execute(input): Promise<ToolResult> {
      if (!sandbox.executeIsolatedCode) {
        return {
          content: [{ type: 'text', text: 'isolated-code capability is not available' }],
          isError: true,
        }
      }

      const code = input.code
      const language = input.language
      if (typeof code !== 'string' || code.length === 0) {
        return { content: [{ type: 'text', text: 'code is required' }], isError: true }
      }
      if (language !== 'python' && language !== 'shell') {
        return { content: [{ type: 'text', text: 'language must be python or shell' }], isError: true }
      }

      try {
        const result = await sandbox.executeIsolatedCode({
          code,
          language,
          image: typeof input.image === 'string' ? input.image : undefined,
          packages: Array.isArray(input.packages)
            ? input.packages.filter((v): v is string => typeof v === 'string')
            : undefined,
          sandboxId: typeof input.sandboxId === 'string' ? input.sandboxId : undefined,
          vmSize:
            input.vmSize === 'xxs' || input.vmSize === 'xs' || input.vmSize === 's' ||
            input.vmSize === 'm' || input.vmSize === 'l'
              ? input.vmSize
              : undefined,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: result.exitCode !== 0,
          details: result,
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'execute_isolated_code failed' }],
          isError: true,
        }
      }
    },
  }
}

export function buildHarnessAgentTools(bundle: RuntimeBundle): AgentTool[] {
  const tools: AgentTool[] = [
    adaptPiTool(createBashToolDefinition(bundle.workspace.root, bashOptionsForMode(bundle))),
  ]

  if (bundle.sandbox.capabilities.includes('isolated-code')) {
    tools.push(createExecuteIsolatedCodeTool(bundle.sandbox))
  }

  return tools
}
