import {
  createGrepToolDefinition,
  formatSize,
  truncateHead,
  truncateLine,
  type GrepToolDetails,
  type TruncationResult,
} from '@mariozechner/pi-coding-agent'

import { resolve, relative } from 'node:path'

import type { Sandbox } from '../../shared/sandbox'
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import { bytesWritten, decode, makeError } from '../catalog/tools/_shared'
import type { RemoteWorkspacePathOptions } from './operations/remoteWorkspace'

const PI_GREP_TOOL = createGrepToolDefinition('/')
const DEFAULT_LIMIT = 100
const GREP_MAX_LINE_LENGTH = 500
const GREP_TIMEOUT_MS = 30_000
const GREP_MAX_OUTPUT_BYTES = 2_097_152

interface RgJsonEvent {
  type?: string
  data?: {
    path?: { text?: string }
    line_number?: number
    lines?: { text?: string }
  }
}

interface ParsedGrep {
  outputLines: string[]
  matchCount: number
  matchLimitReached: boolean
  linesTruncated: boolean
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function numberParam(value: unknown, fallback: number, min = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.floor(value))
}

function optionalStringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function buildRgCommand(params: Record<string, unknown>, searchPath: string): string {
  const args = ['--json', '--line-number', '--color=never', '--hidden']
  if (params.ignoreCase === true) args.push('--ignore-case')
  if (params.literal === true) args.push('--fixed-strings')

  const glob = optionalStringParam(params.glob)
  if (glob) args.push('--glob', quoteShell(glob))

  const context = numberParam(params.context, 0, 0)
  if (context > 0) args.push('--context', String(context))

  const pattern = params.pattern as string
  args.push('--', quoteShell(pattern), quoteShell(searchPath))

  return `rg ${args.join(' ')}`
}

function parseRgJson(stdout: string, limit: number, pathOptions?: RemoteWorkspacePathOptions): ParsedGrep {
  const outputLines: string[] = []
  let matchCount = 0
  let matchLimitReached = false
  let linesTruncated = false

  for (const rawLine of stdout.split('\n')) {
    if (rawLine.trim().length === 0) continue

    let event: RgJsonEvent
    try {
      event = JSON.parse(rawLine) as RgJsonEvent
    } catch {
      continue
    }

    const filePath = event.data?.path?.text
    const lineNumber = event.data?.line_number
    const lineText = event.data?.lines?.text
    if (!filePath || typeof lineNumber !== 'number' || typeof lineText !== 'string') {
      continue
    }

    const isMatch = event.type === 'match'
    if (isMatch) {
      matchCount += 1
      if (matchCount > limit) {
        matchLimitReached = true
        break
      }
    } else if (event.type !== 'context') {
      continue
    }

    const sanitized = lineText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '')
      .replace(/\n$/, '')
    const { text, wasTruncated } = truncateLine(sanitized)
    if (wasTruncated) linesTruncated = true

    const separator = isMatch ? ':' : '-'
    outputLines.push(`${pathOptions?.toRuntimePath?.(filePath) ?? filePath}${separator}${lineNumber}${separator} ${text}`)
  }

  return { outputLines, matchCount, matchLimitReached, linesTruncated }
}

function syntheticExecTruncation(output: string): TruncationResult {
  const outputLines = output.length === 0 ? 0 : output.split('\n').length
  const outputBytes = bytesWritten(output)
  return {
    content: output,
    truncated: true,
    truncatedBy: 'bytes',
    totalLines: outputLines,
    totalBytes: outputBytes,
    outputLines,
    outputBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes: GREP_MAX_OUTPUT_BYTES,
  }
}

function isOutsideWorkspace(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || rel.startsWith('/')
}

function isUnderRoot(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isOutsideWorkspace(rel)
}

function normalizeSearchPath(
  rawPath: unknown,
  workspaceRoot: string | undefined,
  pathOptions: RemoteWorkspacePathOptions | undefined,
): { ok: true; path: string } | { ok: false; message: string } {
  const path = optionalStringParam(rawPath) ?? '.'
  if (!workspaceRoot) return { ok: true, path: pathOptions?.toRemotePath?.(path) ?? path }

  if (!path.startsWith('/')) {
    const resolved = resolve(workspaceRoot, path)
    const rel = relative(workspaceRoot, resolved)
    if (isOutsideWorkspace(rel)) return { ok: false, message: `path "${path}" is outside workspace` }
    return { ok: true, path }
  }

  const roots = [workspaceRoot, ...(pathOptions?.rootAliases ?? [])]
  if (!roots.some((root) => isUnderRoot(root, path))) return { ok: false, message: `path "${path}" is outside workspace` }
  return { ok: true, path: pathOptions?.toRemotePath?.(path) ?? path }
}

function sanitizeErrorMessage(message: string, pathOptions: RemoteWorkspacePathOptions | undefined): string {
  return pathOptions?.sanitizeErrorText?.(message) ?? message
}

function buildSuccessResult(
  parsed: ParsedGrep,
  effectiveLimit: number,
  sandboxTruncated: boolean,
): ToolResult {
  if (parsed.matchCount === 0) {
    return {
      content: [{ type: 'text', text: 'No matches found' }],
      details: undefined,
    }
  }

  const rawOutput = parsed.outputLines.join('\n')
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER })
  let output = truncation.content
  const details: GrepToolDetails = {}
  const notices: string[] = []

  if (parsed.matchLimitReached) {
    notices.push(
      `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
    )
    details.matchLimitReached = effectiveLimit
  }
  if (truncation.truncated || sandboxTruncated) {
    const effectiveTruncation = truncation.truncated
      ? truncation
      : syntheticExecTruncation(output)
    notices.push(`${formatSize(effectiveTruncation.maxBytes)} limit reached`)
    details.truncation = effectiveTruncation
  }
  if (parsed.linesTruncated) {
    notices.push(
      `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
    )
    details.linesTruncated = true
  }
  if (notices.length > 0) output += `\n\n[${notices.join('. ')}]`

  return {
    content: [{ type: 'text', text: output }],
    details: Object.keys(details).length > 0 ? details : undefined,
  }
}

export function remoteWorkspaceGrepTool(
  sandbox: Sandbox,
  workspaceRoot?: string,
  pathOptions?: RemoteWorkspacePathOptions,
): AgentTool {
  return {
    name: PI_GREP_TOOL.name,
    description: PI_GREP_TOOL.description,
    promptSnippet: PI_GREP_TOOL.promptSnippet,
    parameters: PI_GREP_TOOL.parameters as unknown as Record<string, unknown>,
    async execute(input, ctx: ToolExecContext): Promise<ToolResult> {
      const params = input as Record<string, unknown>
      if (ctx.abortSignal.aborted) {
        return makeError('grep aborted')
      }

      if (typeof params.pattern !== 'string' || params.pattern.length === 0) {
        return makeError('pattern is required')
      }

      const searchPath = normalizeSearchPath(params.path, workspaceRoot, pathOptions)
      if (!searchPath.ok) return makeError(searchPath.message)

      try {
        const result = await sandbox.exec(buildRgCommand(params, searchPath.path), {
          signal: ctx.abortSignal,
          timeoutMs: GREP_TIMEOUT_MS,
          maxOutputBytes: GREP_MAX_OUTPUT_BYTES,
        })

        if (result.exitCode !== 0 && result.exitCode !== 1) {
          const stderr = sanitizeErrorMessage(decode(result.stderr).trim(), pathOptions)
          const message = stderr || `ripgrep exited with code ${result.exitCode}`
          return makeError(`grep failed: ${message}`)
        }

        const limit = numberParam(params.limit, DEFAULT_LIMIT)
        const parsed = parseRgJson(decode(result.stdout), limit, pathOptions)
        return buildSuccessResult(parsed, limit, result.truncated)
      } catch (error) {
        const message =
          error instanceof Error ? sanitizeErrorMessage(error.message, pathOptions) : 'unknown error'
        return makeError(`grep failed: ${message}`)
      }
    },
  }
}

