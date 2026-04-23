import type { AgentTool, ToolResult } from '../../../shared/tool'
import type { Sandbox } from '../../../shared/sandbox'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576

const decoder = new TextDecoder('utf-8', { fatal: false })

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
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
    },
    async execute(params, ctx): Promise<ToolResult> {
      const command = params.command
      if (typeof command !== 'string' || command.length === 0) {
        return {
          content: [{ type: 'text', text: 'command is required' }],
          isError: true,
        }
      }

      let result
      try {
        result = await sandbox.exec(command, {
          signal: ctx.abortSignal,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'exec failed'
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        }
      }

      const stdout = decode(result.stdout)
      const stderr = decode(result.stderr)

      const output = JSON.stringify({
        stdout,
        stderr,
        exitCode: result.exitCode,
        truncated: result.truncated,
      })

      return {
        content: [{ type: 'text', text: output }],
        isError: result.exitCode !== 0,
        details: {
          stdout,
          stderr,
          exitCode: result.exitCode,
          truncated: result.truncated,
          durationMs: result.durationMs,
        },
      }
    },
  }
}
