import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { isAbsolute, relative } from 'node:path'

import type { AgentTool, ToolExecContext } from '../../../shared/tool'
import { getRuntimeBundleStorageRoot, type RuntimeBundle, type RuntimeFilesystemBinding, type RuntimeFilesystemStrategy } from '../../runtime/mode'
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

function withFilesystemParameter(parameters: unknown, filesystemIds: readonly string[], dynamicBindings = false): Record<string, unknown> {
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
          ? 'Logical filesystem to use. Omit or use user for workspace files; use an advertised named filesystem for bound context.'
          : 'Logical filesystem to use. Omit or use user for workspace files.',
        ...(dynamicBindings ? {} : { enum: ['user', ...filesystemIds] }),
      },
    },
  }
}

function requestedFilesystem(params: Record<string, unknown>): string {
  const value = params.filesystem
  return typeof value === 'string' && value.length > 0 ? value : 'user'
}

function workspaceRelativeGuardPath(path: string, bundle: RuntimeBundle): string {
  if (!isAbsolute(path)) return path
  const rel = relative(bundle.workspace.root, path)
  return rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) ? rel : path
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

function filesystemBinding(bindings: readonly RuntimeFilesystemBinding[], filesystem: string): RuntimeFilesystemBinding {
  const binding = bindings.find((entry) => entry.filesystem === filesystem)
  if (!binding) throw new Error(`No filesystem binding is available for ${filesystem}`)
  return binding
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

interface ExactEdit {
  oldText: string
  newText: string
}

function applyExactEdits(original: string, edits: readonly ExactEdit[]): string {
  if (edits.length === 0) throw new Error('edit requires at least one edit')
  const ranges = edits.map((edit) => {
    if (!edit.oldText) throw new Error('edit oldText must not be empty')
    const start = original.indexOf(edit.oldText)
    const duplicate = start >= 0 ? original.indexOf(edit.oldText, start + 1) : -1
    if (start < 0 || duplicate >= 0) {
      const occurrences = start < 0 ? 0 : 2
      throw new Error(`edit requires oldText to match exactly once; found ${occurrences}`)
    }
    return { ...edit, start, end: start + edit.oldText.length }
  }).sort((left, right) => left.start - right.start)

  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) throw new Error('edit ranges must not overlap')
  }

  let output = original
  for (const range of ranges.reverse()) {
    output = `${output.slice(0, range.start)}${range.newText}${output.slice(range.end)}`
  }
  return output
}

async function executeBoundFilesystemTool(
  toolName: string,
  filesystem: string,
  params: Record<string, unknown>,
  bindings: readonly RuntimeFilesystemBinding[],
): Promise<PiToolResultLike> {
  const path = boundFilesystemPath(params)
  assertNotFilesystemPathSpoof(path, bindings.map((binding) => binding.filesystem))
  const binding = filesystemBinding(bindings, filesystem)
  const operations = binding.operations

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
  if (toolName === 'write') {
    if (binding.access !== 'readwrite' || !operations.write) operations.rejectMutation(toolName, { filesystem, path })
    const write = operations.write
    if (!write) throw new Error(`Tool ${toolName} does not support filesystem ${filesystem}`)
    const content = typeof params.content === 'string' ? params.content : ''
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : null
    if (parent && operations.mkdir) await operations.mkdir({ filesystem, path: parent, recursive: true })
    const result = await write({ filesystem, path, content })
    return { content: [{ type: 'text', text: `Wrote ${path}` }], details: { metadata: result.metadata, mtimeMs: result.mtimeMs } }
  }
  if (toolName === 'edit') {
    if (binding.access !== 'readwrite' || !operations.write) operations.rejectMutation(toolName, { filesystem, path })
    const write = operations.write
    if (!write) throw new Error(`Tool ${toolName} does not support filesystem ${filesystem}`)
    const edits = Array.isArray(params.edits)
      ? params.edits.map((edit) => {
          if (!edit || typeof edit !== 'object') throw new Error('edit entries must be objects')
          const record = edit as Record<string, unknown>
          if (typeof record.oldText !== 'string' || typeof record.newText !== 'string') {
            throw new Error('edit entries require string oldText and newText')
          }
          return { oldText: record.oldText, newText: record.newText }
        })
      : []
    const current = await operations.read({ filesystem, path })
    const content = applyExactEdits(current.content, edits)
    const result = await write({
      filesystem,
      path,
      content,
      ...(current.mtimeMs !== undefined ? { expectedMtimeMs: current.mtimeMs } : {}),
    })
    return { content: [{ type: 'text', text: `Edited ${path}` }], details: { metadata: result.metadata, mtimeMs: result.mtimeMs } }
  }
  throw new Error(`Tool ${toolName} does not support filesystem ${filesystem}`)
}

function withBoundFilesystemPromptGuidance(promptSnippet: string | undefined, filesystemIds: readonly string[], dynamicBindings = false): string | undefined {
  if (filesystemIds.length === 0 && !dynamicBindings) return promptSnippet
  const target = filesystemIds.length > 0 ? ` (${filesystemIds.join(', ')})` : ''
  const guidance = [
    'Named filesystem bindings: file tools default to the user workspace when filesystem is omitted.',
    `Use the filesystem parameter explicitly for named context${target}, and start browsing at / unless told otherwise.`,
    'A binding may be readonly or readwrite; do not use path prefixes like filesystem:/x to switch filesystem.',
  ].join('\n')
  return [promptSnippet, guidance].filter(Boolean).join('\n')
}

export interface BuildFilesystemAgentToolsOptions {
  getFilesystemBindings?: (ctx: ToolExecContext) => Promise<RuntimeBundle['filesystemBindings'] | undefined> | RuntimeBundle['filesystemBindings'] | undefined
  isReadonlyWorkspacePath?: (path: string, ctx: ToolExecContext) => boolean | Promise<boolean>
}

function withFilesystemRouting(tool: AgentTool, bundle: RuntimeBundle, options: BuildFilesystemAgentToolsOptions = {}): AgentTool {
  const ids = filesystemIds(bundle)
  const dynamicBindings = Boolean(options.getFilesystemBindings)
  return {
    ...tool,
    promptSnippet: withBoundFilesystemPromptGuidance(tool.promptSnippet, ids, dynamicBindings),
    parameters: withFilesystemParameter(tool.parameters, ids, dynamicBindings),
    async execute(params, ctx) {
      const filesystem = requestedFilesystem(params)
      if (filesystem !== 'user') {
        const bindings = options.getFilesystemBindings ? await options.getFilesystemBindings(ctx) ?? [] : filesystemBindings(bundle)
        const result = await executeBoundFilesystemTool(tool.name, filesystem, params, bindings)
        const textContent = (result.content ?? [])
          .filter(isTextContent)
          .map((c) => ({ type: 'text' as const, text: c.text }))
        return {
          content: textContent.length > 0 ? textContent : [{ type: 'text', text: '' }],
          isError: false,
          details: result.details,
        }
      }
      if (
        (tool.name === 'write' || tool.name === 'edit')
        && typeof params.path === 'string'
        && await options.isReadonlyWorkspacePath?.(workspaceRelativeGuardPath(params.path, bundle), ctx)
      ) {
        throw new Error('skill file is readonly')
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

export function buildFilesystemAgentTools(bundle: RuntimeBundle, options: BuildFilesystemAgentToolsOptions = {}): AgentTool[] {
  const cwd = bundle.workspace.root
  const strategy = bundle.filesystem ?? defaultFilesystemStrategyForBundle(bundle)

  if (strategy.kind === 'remote-workspace') {
    return buildRemoteWorkspaceFilesystemAgentTools(bundle, strategy.pathOptions)
      .map((tool) => withFilesystemRouting(tool, bundle, options))
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
  ].map((tool) => withFilesystemRouting(tool, bundle, options))
}
