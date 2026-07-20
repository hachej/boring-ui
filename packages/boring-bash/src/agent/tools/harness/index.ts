import { unlink } from 'node:fs/promises'
import { createBashToolDefinition } from '@mariozechner/pi-coding-agent'

import type { AgentTool, Sandbox, ToolResult } from '@hachej/boring-agent/shared'
import {
  runtimeNotReadyToolResult,
  type ToolReadinessRequirement,
  type ToolReadinessState,
} from '../../runtime/toolReadiness'
import { createBashToolOptionsForRuntime } from './bashToolOptions'
import type { RuntimeProvisioningOptions, RuntimeProvisioningSnapshot } from '../../runtime/env'
import type { RuntimeBundle } from '../../runtime/types'

export type HarnessRuntimeProvisioningSnapshot = RuntimeProvisioningSnapshot

export interface HarnessRuntimeProvisioningOptions extends RuntimeProvisioningOptions {
  getReadiness?: () => ToolReadinessState
}

function bashOptionsForBundle(
  bundle: RuntimeBundle,
  runtime?: HarnessRuntimeProvisioningOptions,
  executionRuntimeEnv?: Record<string, string>,
) {
  return createBashToolOptionsForRuntime(bundle, runtime, executionRuntimeEnv)
}

function runtimeSecretValues(env: Record<string, string> | undefined): string[] {
  return Object.entries(env ?? {})
    .filter(([key, value]) => key !== 'PATH' && /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY/i.test(key) && value.length > 0)
    .map(([, value]) => value)
}

function redactSecretsInString(text: string, secrets: readonly string[]): string {
  return secrets.reduce((current, secret) => current.split(secret).join('[REDACTED]'), text)
}

function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value
  if (typeof value === 'string') return redactSecretsInString(value, secrets) as T
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets)) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, redactSecrets(child, secrets)]),
  ) as T
}

function isRuntimeReady(readiness: ToolReadinessState | undefined): boolean {
  return readiness === undefined || readiness === true || (typeof readiness === 'object' && readiness !== null && readiness.ready === true)
}

function runtimeRequirementForCommand(command: string): ToolReadinessRequirement | undefined {
  if (command.includes('.boring-agent/venv/bin/')) return 'runtime:python'
  if (/python(?:3)?\s+-c\s+['\"][^'\"]*(?:from\s+\S+\s+)?import\s+/.test(command)) return 'runtime:python'
  if (command.includes('.boring-agent/node/')) return 'runtime:node'
  if (command.includes('.boring-agent/')) return 'runtime-dependencies'
  return undefined
}

function runtimeRequirementForFailure(text: string): ToolReadinessRequirement | undefined {
  if (/\.boring-agent\/venv\/bin\/[^\s:]+: (?:No such file or directory|not found)/i.test(text)) return 'runtime:python'
  if (/ModuleNotFoundError: No module named ['\"][^'\"]+['\"]/i.test(text)) return 'runtime:python'
  if (/\.boring-agent\/node\/[^\s:]+: (?:No such file or directory|not found)/i.test(text)) return 'runtime:node'
  if (/(?:^|\n)(?:[^\n:]+:\s*)?(?:line \d+:\s*)?[A-Za-z0-9_.-]+: command not found/i.test(text)) return 'runtime-dependencies'
  return undefined
}

function runtimeNotReadyFromState(
  requirement: ToolReadinessRequirement,
  readiness: ToolReadinessState | undefined,
): ToolResult {
  return runtimeNotReadyToolResult(requirement,
    readiness && typeof readiness === 'object' && readiness.ready === false
      ? readiness
      : { ready: false, state: 'preparing', retryable: true })
}

function adaptPiTool(
  bundle: RuntimeBundle,
  runtime?: HarnessRuntimeProvisioningOptions,
): AgentTool {
  const template = createBashToolDefinition(bundle.workspace.root, bashOptionsForBundle(bundle, runtime))
  return {
    name: template.name,
    description: template.description,
    promptSnippet: template.promptSnippet,
    parameters: template.parameters as unknown as Record<string, unknown>,
    readinessRequirements: ['sandbox-exec'],
    async execute(params, ctx) {
      const command = typeof params.command === 'string' ? params.command : ''
      const readiness = runtime?.getReadiness?.()
      const commandRuntimeRequirement = command ? runtimeRequirementForCommand(command) : undefined
      if (commandRuntimeRequirement && !isRuntimeReady(readiness)) {
        return runtimeNotReadyFromState(commandRuntimeRequirement, readiness)
      }

      const runtimeEnv = await bundle.getRuntimeEnv?.()
      const secrets = runtimeSecretValues(runtimeEnv)
      const executionBundle = runtimeEnv === undefined
        ? bundle
        : {
            ...bundle,
            getRuntimeEnv: async () => runtimeEnv,
          }
      const piTool = createBashToolDefinition(
        bundle.workspace.root,
        bashOptionsForBundle(executionBundle, runtime, runtimeEnv),
      )
      let emittedRedactionNotice = false
      let result: Awaited<ReturnType<typeof piTool.execute>>
      try {
        result = await piTool.execute(
          ctx.toolCallId,
          params as any,
          ctx.abortSignal,
          ctx.onUpdate
            ? (update) => {
                const text = update.content
                  .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                  .map((c) => c.text)
                  .join('')
                if (secrets.length === 0) {
                  ctx.onUpdate!(text)
                  return
                }
                if (!emittedRedactionNotice) {
                  emittedRedactionNotice = true
                  ctx.onUpdate!('[streaming output redacted while runtime secrets are in scope]')
                }
              }
            : undefined,
          {} as never,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const latestReadiness = runtime?.getReadiness?.()
        const failureRuntimeRequirement = runtimeRequirementForFailure(message)
        if (command && failureRuntimeRequirement && !isRuntimeReady(latestReadiness)) {
          return runtimeNotReadyFromState(failureRuntimeRequirement, latestReadiness)
        }
        return {
          content: [{ type: 'text', text: redactSecretsInString(message, secrets) }],
          isError: true,
          details: {},
        }
      }

      if (secrets.length > 0 && result.details && typeof result.details === 'object' && 'fullOutputPath' in result.details && typeof (result.details as { fullOutputPath?: unknown }).fullOutputPath === 'string') {
        await unlink((result.details as { fullOutputPath: string }).fullOutputPath).catch(() => undefined)
        delete (result.details as { fullOutputPath?: string }).fullOutputPath
      }
      const textContent = (result.content ?? [])
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: redactSecretsInString(c.text, secrets) }))
      const text = textContent.map((part) => part.text).join('\n')
      const latestReadiness = runtime?.getReadiness?.()
      const failureRuntimeRequirement = runtimeRequirementForFailure(text)
      if (command && failureRuntimeRequirement && !isRuntimeReady(latestReadiness)) {
        return runtimeNotReadyFromState(failureRuntimeRequirement, latestReadiness)
      }
      return {
        content: textContent.length > 0 ? textContent : [{ type: 'text', text: '' }],
        isError: Boolean((result as { isError?: unknown }).isError),
        details: redactSecrets(result.details, secrets),
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
    adaptPiTool(bundle, runtime),
  ]

  if (bundle.sandbox.capabilities.includes('isolated-code')) {
    tools.push(createExecuteIsolatedCodeTool(bundle.sandbox))
  }

  return tools
}
