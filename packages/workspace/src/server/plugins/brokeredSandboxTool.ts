import path from 'node:path'

import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import { z } from 'zod'

import type { AgentTool, ToolResult } from '../../shared/types/agent-tool'

export const BROKERED_SANDBOX_TOOL_MAX_OUTPUT_BYTES = 64 * 1024

const toolNameSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
    'tool name must start with a letter and contain only letters, numbers, underscores, or hyphens',
  )

export const brokeredSandboxToolManifestSchema = z
  .object({
    name: toolNameSchema,
    description: z.string().trim().min(1).max(2_000),
    parameters: z.record(z.unknown()),
    run: z
      .object({
        command: z.array(z.string().min(1)).min(1).max(128),
        cwd: z.string().min(1).optional(),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(10 * 60_000)
          .optional(),
        stdin: z.literal('json').optional(),
      })
      .strict(),
  })
  .strict()

export type BrokeredSandboxToolManifest = z.infer<
  typeof brokeredSandboxToolManifestSchema
>

export function parseBrokeredSandboxToolManifest(
  value: unknown,
): BrokeredSandboxToolManifest {
  return brokeredSandboxToolManifestSchema.parse(value)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function isAbsolutePath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
}

function containedAbsolutePath(value: string, workspaceRoot: string): boolean {
  const flavor = path.win32.isAbsolute(value) ? path.win32 : path.posix
  const normalizedValue = flavor.normalize(value)
  const normalizedRoot = flavor.normalize(workspaceRoot)
  const relative = flavor.relative(normalizedRoot, normalizedValue)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !flavor.isAbsolute(relative))
  )
}

function resolveCwd(cwd: string | undefined, workspaceRoot: string): string {
  if (!cwd) return workspaceRoot
  if (isAbsolutePath(cwd)) {
    if (!containedAbsolutePath(cwd, workspaceRoot)) {
      throw new Error(
        `brokered tool cwd must stay inside the workspace: ${cwd}`,
      )
    }
    return cwd
  }
  const normalized = path.posix.normalize(cwd.replaceAll('\\', '/'))
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`brokered tool cwd must stay inside the workspace: ${cwd}`)
  }
  return path.posix.join(workspaceRoot, normalized)
}

function relativeCwd(cwd: string | undefined, workspaceRoot: string): string {
  if (!cwd) return '.'
  return isAbsolutePath(cwd)
    ? path.posix.relative(workspaceRoot.replaceAll('\\', '/'), cwd.replaceAll('\\', '/')) || '.'
    : path.posix.normalize(cwd.replaceAll('\\', '/'))
}

function relativeRuntimePath(
  value: string,
  argumentIndex: number,
  workspaceRoot: string,
  cwd: string,
): string | undefined {
  const slashPath = value.replaceAll('\\', '/')
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(slashPath)) return undefined
  if (isAbsolutePath(value)) {
    if (!containedAbsolutePath(value, workspaceRoot)) {
      throw new Error(`brokered tool command path must stay inside the workspace: ${value}`)
    }
    return path.posix.relative(workspaceRoot.replaceAll('\\', '/'), slashPath)
  }
  const normalized = path.posix.normalize(slashPath)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`brokered tool command path must stay inside the workspace: ${value}`)
  }
  const looksLikePath = slashPath.includes('/')
    || (argumentIndex > 0 && /\.(?:[cm]?js|ts|py|sh)$/i.test(normalized))
  return looksLikePath ? path.posix.join(cwd, normalized) : undefined
}

function declaredCommandPaths(
  command: readonly string[],
  workspaceRoot: string,
  cwd: string | undefined,
): string[] {
  const commandCwd = relativeCwd(cwd, workspaceRoot)
  return command.flatMap((argument, index) => {
    const relative = relativeRuntimePath(argument, index, workspaceRoot, commandCwd)
    return relative === undefined || relative === '' ? [] : [relative]
  })
}

async function assertAdapterContainedPaths(
  workspace: Workspace,
  workspaceRoot: string,
  cwd: string | undefined,
  commandPaths: readonly string[],
): Promise<void> {
  if (cwd) {
    const stat = await workspace.stat(relativeCwd(cwd, workspaceRoot))
    if (stat.kind !== 'dir') throw new Error(`brokered tool cwd is not a directory: ${cwd}`)
  }
  for (const relativePath of commandPaths) {
    try {
      await workspace.stat(relativePath)
    } catch {
      throw new Error(`brokered tool command path is unavailable inside the workspace: ${relativePath}`)
    }
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function text(body: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: body }],
    ...(isError ? { isError: true } : {}),
  }
}

/**
 * Converts one validated declarative manifest into a host AgentTool whose body
 * is always executed by the caller's paired sandbox. No workspace JavaScript
 * is imported into the host process.
 */
export function createBrokeredSandboxTool(
  value: unknown,
  options: {
    readonly workspace: Workspace
    readonly sandbox: Sandbox
    /** Explicit host-owned grant for trusted direct-mode development only. */
    readonly allowUnisolatedDirectExecution?: boolean
  },
): AgentTool {
  const manifest = parseBrokeredSandboxToolManifest(value)
  if (
    options.sandbox.provider === 'direct' &&
    options.allowUnisolatedDirectExecution !== true
  ) {
    throw new Error(
      'brokered workspace tools require an isolated sandbox provider',
    )
  }
  const workspaceRoot = options.sandbox.runtimeContext.runtimeCwd
  const cwd = resolveCwd(manifest.run.cwd, workspaceRoot)
  const commandPaths = declaredCommandPaths(manifest.run.command, workspaceRoot, manifest.run.cwd)
  const command = manifest.run.command.map(shellQuote).join(' ')

  return {
    name: manifest.name,
    description: manifest.description,
    parameters: manifest.parameters,
    readinessRequirements: ['sandbox-exec'],
    async execute(params, ctx) {
      const input = JSON.stringify(params)
      const invocation =
        manifest.run.stdin === undefined || manifest.run.stdin === 'json'
          ? `printf '%s' ${shellQuote(input)} | ${command}`
          : command
      try {
        await assertAdapterContainedPaths(options.workspace, workspaceRoot, manifest.run.cwd, commandPaths)
        const result = await options.sandbox.exec(invocation, {
          cwd,
          signal: ctx.abortSignal,
          timeoutMs: manifest.run.timeoutMs,
          maxOutputBytes: BROKERED_SANDBOX_TOOL_MAX_OUTPUT_BYTES,
        })
        const stdout = decode(result.stdout)
        if (result.exitCode === 0) return text(stdout)
        const stderr = decode(result.stderr)
        const suffix = result.truncated ? '\n(output truncated)' : ''
        return text(
          [`Command failed with exit code ${result.exitCode}.`, stderr.trim()]
            .filter(Boolean)
            .join('\n') + suffix,
          true,
        )
      } catch (error) {
        return text(
          error instanceof Error ? error.message : String(error),
          true,
        )
      }
    },
  }
}
