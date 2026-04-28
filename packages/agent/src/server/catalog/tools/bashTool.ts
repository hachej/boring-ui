import type { AgentTool, ToolResult } from '../../../shared/tool'
import type { Sandbox } from '../../../shared/sandbox'
import { decode, type FileChangeMetadata, makeError } from './_shared'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576

function extractRedirectWrites(
  segment: string,
  timestamp: string,
): FileChangeMetadata[] {
  const changes: FileChangeMetadata[] = []
  let i = 0
  let quote: '"' | "'" | null = null
  let escaped = false

  while (i < segment.length) {
    const ch = segment[i]

    if (quote !== null) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\' && quote === '"') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      i += 1
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      i += 1
      continue
    }

    if (ch !== '>') {
      i += 1
      continue
    }

    i += 1
    if (segment[i] === '>') i += 1
    while (i < segment.length && /\s/.test(segment[i])) i += 1
    if (i >= segment.length) break

    let path = ''
    if (segment[i] === '"' || segment[i] === "'") {
      const pathQuote = segment[i]
      i += 1
      const start = i
      while (i < segment.length && segment[i] !== pathQuote) i += 1
      path = segment.slice(start, i)
      if (i < segment.length && segment[i] === pathQuote) i += 1
    } else {
      const start = i
      while (
        i < segment.length &&
        !/\s/.test(segment[i]) &&
        segment[i] !== ';' &&
        segment[i] !== '&' &&
        segment[i] !== '|'
      ) {
        i += 1
      }
      path = segment.slice(start, i)
    }

    if (path.length > 0) {
      changes.push({ op: 'write', path, timestamp })
    }
  }

  return changes
}

function splitShellWords(input: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g
  let match: RegExpExecArray | null = pattern.exec(input)
  while (match) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
    match = pattern.exec(input)
  }
  return tokens
}

function positionalArgs(args: string[]): string[] {
  const out: string[] = []
  let passthrough = false
  for (const arg of args) {
    if (passthrough) {
      out.push(arg)
      continue
    }
    if (arg === '--') {
      passthrough = true
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    out.push(arg)
  }
  return out
}

function inferChangesFromSegment(
  segment: string,
  timestamp: string,
): FileChangeMetadata[] {
  const changes: FileChangeMetadata[] = extractRedirectWrites(segment, timestamp)

  const tokens = splitShellWords(segment.trim())
  if (tokens.length === 0) {
    return changes
  }

  const cmd = (tokens[0].split('/').pop() ?? tokens[0]).toLowerCase()
  const args = tokens.slice(1)
  const positional = positionalArgs(args)

  if (cmd === 'rm') {
    for (const path of positional) {
      changes.push({ op: 'unlink', path, timestamp })
    }
  } else if (cmd === 'mkdir') {
    for (const path of positional) {
      changes.push({ op: 'mkdir', path, timestamp })
    }
  } else if (cmd === 'touch') {
    for (const path of positional) {
      changes.push({ op: 'write', path, timestamp })
    }
  } else if (cmd === 'mv' && positional.length === 2) {
    changes.push({
      op: 'rename',
      oldPath: positional[0],
      path: positional[1],
      timestamp,
    })
  } else if (
    cmd === 'sed' &&
    args.some((arg) => arg === '-i' || /^-i.+/.test(arg)) &&
    positional.length > 0
  ) {
    const editedPaths = positional.slice(1)
    for (const path of editedPaths) {
      changes.push({
        op: 'edit',
        path,
        timestamp,
      })
    }
  }

  return changes
}

function inferBashFileChanges(
  command: string,
  exitCode: number,
): FileChangeMetadata[] {
  if (exitCode !== 0) {
    return []
  }
  if (command.includes('||')) {
    return []
  }

  const timestamp = new Date().toISOString()
  const segments = command
    .split(/&&|\|\||;|\n/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  return segments.flatMap((segment) => inferChangesFromSegment(segment, timestamp))
}

export function createBashTool(sandbox: Sandbox): AgentTool {
  return {
    name: 'bash',
    description: 'Execute a bash command in the workspace sandbox.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    async execute(input, ctx): Promise<ToolResult> {
      const params = input as Record<string, unknown>
      if (ctx.abortSignal.aborted) {
        return makeError('bash aborted')
      }

      const command = params.command
      if (typeof command !== 'string' || command.length === 0) {
        return makeError('command is required')
      }

      let result
      try {
        result = await sandbox.exec(command, {
          signal: ctx.abortSignal,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error'
        return makeError(`bash failed: ${message}`)
      }

      const stdout = decode(result.stdout)
      const stderr = decode(result.stderr)

      const output = JSON.stringify({
        stdout,
        stderr,
        exitCode: result.exitCode,
        truncated: result.truncated,
      })

      const fileChanges = inferBashFileChanges(command, result.exitCode)

      // content[0].text is what the model sees; details carries structured data for the UI.
      return {
        content: [{ type: 'text', text: output }],
        isError: result.exitCode !== 0,
        details: {
          stdout,
          stderr,
          exitCode: result.exitCode,
          truncated: result.truncated,
          durationMs: result.durationMs,
          ...(fileChanges.length > 0 ? { fileChanges } : {}),
        },
      }
    },
  }
}
