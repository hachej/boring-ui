import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@mariozechner/pi-coding-agent'

import type { AgentTool } from '../../../shared/tool'
import { getRuntimeBundleStorageRoot, type RuntimeBundle, type RuntimeFilesystemBindingOperations, type RuntimeFilesystemStrategy } from '../../runtime/mode'
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

function filesystemBindings(bundle: RuntimeBundle) {
  return bundle.filesystemBindings ?? []
}

function filesystemIds(bundle: RuntimeBundle): string[] {
  return filesystemBindings(bundle).map((binding) => binding.filesystem)
}

function withFilesystemParameter(parameters: unknown, filesystemIds: readonly string[]): Record<string, unknown> {
  const schema: Record<string, unknown> = parameters && typeof parameters === 'object'
    ? { ...(parameters as Record<string, unknown>) }
    : { type: 'object' }
  const properties = schema.properties && typeof schema.properties === 'object'
    ? { ...(schema.properties as Record<string, unknown>) }
    : {}
  return {
    ...schema,
    properties: {
      ...properties,
      filesystem: {
        type: 'string',
        description: filesystemIds.length > 0
          ? 'Logical filesystem to use. Omit or use user for workspace files; use an advertised named filesystem for bound readonly context.'
          : 'Logical filesystem to use. Omit or use user for workspace files.',
        enum: ['user', ...filesystemIds],
      },
    },
  }
}

function requestedFilesystem(params: Record<string, unknown>): string {
  const value = params.filesystem
  return typeof value === 'string' && value.length > 0 ? value : 'user'
}

function withoutFilesystem<TParams extends Record<string, unknown>>(params: Record<string, unknown>): TParams {
  const { filesystem: _filesystem, ...rest } = params
  return rest as TParams
}

function boundFilesystemPath(params: Record<string, unknown>): string {
  const value = params.path
  return typeof value === 'string' && value.length > 0 ? value : '/'
}

function assertNotFilesystemPathSpoof(path: string, filesystemIds: readonly string[]): void {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.includes(':/') || filesystemIds.some((filesystem) => normalized === `/${filesystem}` || normalized.startsWith(`/${filesystem}/`))) {
    throw new Error('filesystem prefixes are not valid path strings; use the filesystem parameter')
  }
}

function filesystemBinding(bundle: RuntimeBundle, filesystem: string) {
  return filesystemBindings(bundle).find((binding) => binding.filesystem === filesystem)
}

function boundOperations(bundle: RuntimeBundle, filesystem: string): RuntimeFilesystemBindingOperations {
  const binding = filesystemBinding(bundle, filesystem)
  if (!binding) throw new Error(`No filesystem binding is available for ${filesystem}`)
  return binding.operations
}

function formatBoundRead(content: string): PiToolResultLike {
  return { content: [{ type: 'text', text: content }] }
}

function formatBoundList(entries: string[]): PiToolResultLike {
  return { content: [{ type: 'text', text: entries.join('\n') }] }
}

function formatBoundFind(paths: string[]): PiToolResultLike {
  return { content: [{ type: 'text', text: paths.join('\n') }] }
}

function formatBoundGrep(matches: Array<{ path: string; line: number; text: string }>): PiToolResultLike {
  return { content: [{ type: 'text', text: matches.map((match) => `${match.path}:${match.line}:${match.text}`).join('\n') }] }
}

async function executeBoundFilesystemTool(toolName: string, filesystem: string, params: Record<string, unknown>, bundle: RuntimeBundle): Promise<PiToolResultLike> {
  const path = boundFilesystemPath(params)
  assertNotFilesystemPathSpoof(path, filesystemIds(bundle))
  const operations = boundOperations(bundle, filesystem)

  if (toolName === 'read') {
    const result = await operations.read({ filesystem, path })
    return { ...formatBoundRead(result.content), details: { metadata: result.metadata } }
  }
  if (toolName === 'ls') {
    const result = await operations.list({ filesystem, path })
    return { ...formatBoundList(result.entries), details: { metadata: result.metadata } }
  }
  if (toolName === 'find') {
    const pattern = typeof params.pattern === 'string' ? params.pattern : '*'
    const limit = typeof params.limit === 'number' ? params.limit : undefined
    const result = await operations.find({ filesystem, path }, pattern, { limit })
    return { ...formatBoundFind(result.paths), details: { metadata: result.metadata } }
  }
  if (toolName === 'grep') {
    const pattern = typeof params.pattern === 'string' ? params.pattern : ''
    const limit = typeof params.limit === 'number' ? params.limit : undefined
    const result = await operations.grep({ filesystem, path }, pattern, { limit })
    return { ...formatBoundGrep(result.matches), details: { metadata: result.metadata } }
  }
  if (toolName === 'write' || toolName === 'edit') {
    operations.rejectMutation(toolName, { filesystem, path })
  }
  throw new Error(`Tool ${toolName} does not support filesystem ${filesystem}`)
}

function withBoundFilesystemPromptGuidance(promptSnippet: string | undefined, filesystemIds: readonly string[]): string | undefined {
  if (filesystemIds.length === 0) return promptSnippet
  const guidance = [
    'Named filesystem bindings: file tools default to the user workspace when filesystem is omitted.',
    `Use the filesystem parameter explicitly for bound readonly context (${filesystemIds.join(', ')}), and start browsing at / unless told otherwise.`,
    'Readonly filesystem bindings reject writes; do not use path prefixes like filesystem:/x to switch filesystem.',
  ].join('\n')
  return [promptSnippet, guidance].filter(Boolean).join('\n')
}

function withFilesystemRouting(tool: AgentTool, bundle: RuntimeBundle): AgentTool {
  const ids = filesystemIds(bundle)
  return {
    ...tool,
    promptSnippet: withBoundFilesystemPromptGuidance(tool.promptSnippet, ids),
    parameters: withFilesystemParameter(tool.parameters, ids),
    async execute(params, ctx) {
      const filesystem = requestedFilesystem(params)
      if (filesystem !== 'user') {
        const result = await executeBoundFilesystemTool(tool.name, filesystem, params, bundle)
        const textContent = (result.content ?? [])
          .filter(isTextContent)
          .map((c) => ({ type: 'text' as const, text: c.text }))
        return {
          content: textContent.length > 0 ? textContent : [{ type: 'text', text: '' }],
          isError: false,
          details: result.details,
        }
      }
      return await tool.execute(withoutFilesystem(params), ctx)
    },
  }
}

function adaptPiTool<TParams extends Record<string, unknown>>(piTool: PiToolLike<TParams>): AgentTool {
  return {
    name: piTool.name,
    readinessRequirements: ['workspace-fs'],
    description: piTool.description,
    promptSnippet: piTool.promptSnippet,
    parameters: piTool.parameters && typeof piTool.parameters === 'object'
      ? { ...(piTool.parameters as Record<string, unknown>) }
      : { type: 'object' },
    async execute(params, ctx) {
      const result = await piTool.execute(
        ctx.toolCallId,
        withoutFilesystem<TParams>(params),
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
      .map((tool) => withFilesystemRouting(tool, bundle))
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
  ].map((tool) => withFilesystemRouting(tool, bundle))
}
