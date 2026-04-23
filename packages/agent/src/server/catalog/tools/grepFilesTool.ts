import type { Sandbox } from '../../../shared/sandbox'
import type { AgentTool, ToolExecContext, ToolResult } from '../../../shared/tool'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 5_000
const MAX_PATTERN_LENGTH = 256
const GREP_TIMEOUT_MS = 30_000
const GREP_MAX_OUTPUT_BYTES = 2_097_152

interface GrepMatch {
  file: string
  line: number
  text: string
}

interface GrepFilesDetails {
  pattern: string
  glob: string | undefined
  limit: number
  matchCount: number
  matches: GrepMatch[]
  truncated: boolean
}

function makeError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function normalizeLimit(rawLimit: unknown): { limit: number; error?: string } {
  if (rawLimit === undefined) {
    return { limit: DEFAULT_LIMIT }
  }
  if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
    return { limit: DEFAULT_LIMIT, error: 'limit must be a number when provided' }
  }

  const normalized = Math.trunc(rawLimit)
  if (normalized <= 0) {
    return { limit: DEFAULT_LIMIT, error: 'limit must be >= 1 when provided' }
  }

  return { limit: Math.min(normalized, MAX_LIMIT) }
}

const decoder = new TextDecoder('utf-8', { fatal: false })

function parseGrepOutput(stdout: string, limit: number): { matches: GrepMatch[]; truncated: boolean } {
  const matches: GrepMatch[] = []
  let truncated = false

  for (const raw of stdout.split('\n')) {
    if (raw.length === 0) continue

    // grep -Hn output: file:line:text
    const firstColon = raw.indexOf(':')
    if (firstColon === -1) continue
    const secondColon = raw.indexOf(':', firstColon + 1)
    if (secondColon === -1) continue

    const file = raw.slice(0, firstColon)
    const lineNum = parseInt(raw.slice(firstColon + 1, secondColon), 10)
    if (!Number.isFinite(lineNum)) continue

    if (matches.length >= limit) {
      truncated = true
      break
    }

    matches.push({
      file,
      line: lineNum,
      text: raw.slice(secondColon + 1),
    })
  }

  return { matches, truncated }
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

function buildGrepCommand(pattern: string, glob: string | undefined, limit: number): string {
  // Request extra lines so we can detect truncation
  const grepLimit = Math.min(limit + 1, MAX_LIMIT + 1)
  const escapedPattern = escapeShellArg(pattern)

  if (glob !== undefined) {
    const escapedGlob = escapeShellArg(glob)
    // ripgrep preferred; fall back to grep -r
    return `rg -Hn --no-heading -m ${grepLimit} -g ${escapedGlob} -- ${escapedPattern} . 2>/dev/null || grep -rHn --include=${escapedGlob} -m ${grepLimit} -- ${escapedPattern} . 2>/dev/null`
  }

  return `rg -Hn --no-heading -m ${grepLimit} -- ${escapedPattern} . 2>/dev/null || grep -rHn -m ${grepLimit} -- ${escapedPattern} . 2>/dev/null`
}

function formatMatches(matches: GrepMatch[]): string {
  if (matches.length === 0) return 'no matches found'
  return matches.map((m) => `${m.file}:${m.line}:${m.text}`).join('\n')
}

export function createGrepFilesTool(sandbox: Sandbox): AgentTool {
  return {
    name: 'grep_files',
    description:
      'Search file contents by pattern across the workspace. Returns file paths, line numbers, and matching text. Prefer this over shell grep loops, especially in vercel-sandbox mode.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (basic regex supported).',
        },
        glob: {
          type: 'string',
          description: 'Optional file glob filter (e.g. "*.ts", "*.py").',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIMIT,
          description: 'Maximum number of matching lines to return.',
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    async execute(input, ctx: ToolExecContext): Promise<ToolResult> {
      const params = input as Record<string, unknown>
      const pattern = params.pattern
      if (typeof pattern !== 'string' || pattern.length === 0) {
        return makeError('pattern is required')
      }
      if (pattern.includes('\0')) {
        return makeError('pattern must not contain null bytes')
      }
      if (pattern.length > MAX_PATTERN_LENGTH) {
        return makeError(`pattern exceeds ${MAX_PATTERN_LENGTH} chars`)
      }

      const glob = params.glob
      if (glob !== undefined) {
        if (typeof glob !== 'string' || glob.length === 0) {
          return makeError('glob must be a non-empty string when provided')
        }
        if (glob.includes('\0')) {
          return makeError('glob must not contain null bytes')
        }
      }

      const { limit, error } = normalizeLimit(params.limit)
      if (error) {
        return makeError(error)
      }

      if (ctx.abortSignal.aborted) {
        return makeError('grep_files aborted')
      }

      const cmd = buildGrepCommand(pattern, glob as string | undefined, limit)

      try {
        const result = await sandbox.exec(cmd, {
          signal: ctx.abortSignal,
          timeoutMs: GREP_TIMEOUT_MS,
          maxOutputBytes: GREP_MAX_OUTPUT_BYTES,
        })

        const stdout = decoder.decode(result.stdout)

        // grep exits 1 when no matches — not an error
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          const stderr = decoder.decode(result.stderr)
          return makeError(`grep_files failed (exit ${result.exitCode}): ${stderr}`.trim())
        }

        const { matches, truncated } = parseGrepOutput(stdout, limit)

        const details: GrepFilesDetails = {
          pattern,
          glob: glob as string | undefined,
          limit,
          matchCount: matches.length,
          matches,
          truncated: truncated || result.truncated,
        }

        return {
          content: [{ type: 'text', text: formatMatches(matches) }],
          details,
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'unknown grep_files failure'
        return makeError(`grep_files failed: ${message}`)
      }
    },
  }
}
