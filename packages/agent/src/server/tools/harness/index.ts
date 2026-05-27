import {
  type BashSpawnHook,
  type BashToolOptions,
  createBashToolDefinition,
  createLocalBashOperations,
} from '@mariozechner/pi-coding-agent'

import type { Sandbox } from '../../../shared/sandbox'
import type { AgentTool, ToolResult } from '../../../shared/tool'
import type { RuntimeBundle } from '../../runtime/mode'
import { buildBwrapArgs } from '../../sandbox/bwrap/buildBwrapArgs'
import { withWorkspacePythonEnv } from '../../sandbox/workspacePythonEnv'
import { vercelBashOps } from '../operations/vercel'

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

export interface HarnessRuntimeProvisioningSnapshot {
  env?: Record<string, string>
  pathEntries?: string[]
}

export interface HarnessRuntimeProvisioningOptions extends HarnessRuntimeProvisioningSnapshot {
  getCurrent?: () => HarnessRuntimeProvisioningSnapshot | undefined
}

function mergeRuntimeEnv(
  runtime: HarnessRuntimeProvisioningOptions | undefined,
  commandEnv: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> | undefined {
  const current = runtime?.getCurrent?.() ?? runtime
  if (!current?.env && !current?.pathEntries?.length) return commandEnv
  const merged: Record<string, string | undefined> = {
    ...(current.env ?? {}),
    ...(commandEnv ?? {}),
  }
  const pathParts = [...(current.pathEntries ?? [])]
  if (current.env?.PATH) pathParts.push(current.env.PATH)
  if (commandEnv?.PATH) pathParts.push(commandEnv.PATH)
  if (pathParts.length > 0) merged.PATH = pathParts.join(':')
  return merged
}

function bwrapSpawnHook(
  workspaceRoot: string,
  runtime?: HarnessRuntimeProvisioningOptions,
): BashSpawnHook {
  const args = buildBwrapArgs(workspaceRoot)
  const bwrapPrefix = ['bwrap', ...args].map(shellEscape).join(' ')
  return (context) => ({
    ...context,
    command: `${bwrapPrefix} bash -lc ${shellEscape(context.command)}`,
    env: withWorkspacePythonEnv({
      workspaceRoot,
      env: mergeRuntimeEnv(runtime, context.env),
      sandboxRoot: '/workspace',
    }),
  })
}

function directSpawnHook(
  workspaceRoot: string,
  runtime?: HarnessRuntimeProvisioningOptions,
): BashSpawnHook {
  return (context) => ({
    ...context,
    env: withWorkspacePythonEnv({
      workspaceRoot,
      env: mergeRuntimeEnv(runtime, context.env),
    }),
  })
}

const VERCEL_SAFE_DEFAULT_PATH = '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin'

function bashOptionsForMode(
  bundle: RuntimeBundle,
  runtime?: HarnessRuntimeProvisioningOptions,
): BashToolOptions {
  switch (bundle.sandbox.provider) {
    case 'vercel-sandbox':
      return {
        operations: vercelBashOps(bundle.sandbox, {
          // The pi bash tool's env may include the host process env. Never
          // forward host secrets into a remote sandbox; provide only the
          // provisioned runtime env plus a conservative remote PATH tail.
          mergeEnv: () => mergeRuntimeEnv(runtime, { PATH: VERCEL_SAFE_DEFAULT_PATH }),
        }),
      }
    case 'bwrap':
      return {
        operations: createLocalBashOperations(),
        spawnHook: bwrapSpawnHook(bundle.workspace.root, runtime),
      }
    default:
      return {
        operations: createLocalBashOperations(),
        spawnHook: directSpawnHook(bundle.workspace.root, runtime),
      }
  }
}

function adaptPiTool(piTool: ReturnType<typeof createBashToolDefinition>): AgentTool {
  return {
    name: piTool.name,
    description: piTool.description,
    promptSnippet: piTool.promptSnippet,
    parameters: piTool.parameters as unknown as Record<string, unknown>,
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

export function buildHarnessAgentTools(
  bundle: RuntimeBundle,
  runtime?: HarnessRuntimeProvisioningOptions,
): AgentTool[] {
  const tools: AgentTool[] = [
    adaptPiTool(createBashToolDefinition(bundle.workspace.root, bashOptionsForMode(bundle, runtime))),
  ]

  if (bundle.sandbox.capabilities.includes('isolated-code')) {
    tools.push(createExecuteIsolatedCodeTool(bundle.sandbox))
  }

  return tools
}
