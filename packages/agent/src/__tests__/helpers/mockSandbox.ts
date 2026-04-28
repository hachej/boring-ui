import type { ExecOptions, ExecResult, Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'

const encoder = new TextEncoder()

function createDefaultResult(): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 0,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
  }
}

type QueuedResult =
  | Partial<ExecResult>
  | ((cmd: string, opts?: ExecOptions) => ExecResult | Promise<ExecResult>)

function materializeResult(result: Partial<ExecResult>): ExecResult {
  return { ...createDefaultResult(), ...result }
}

function cloneExecOptions(opts?: ExecOptions): ExecOptions | undefined {
  if (!opts) return undefined
  return {
    ...opts,
    env: opts.env ? { ...opts.env } : undefined,
  }
}

export interface MockSandbox extends Sandbox {
  readonly history: Array<{ cmd: string; opts?: ExecOptions }>
  queueResult(result: QueuedResult): void
}

export function mockSandbox(
  capabilities: Sandbox['capabilities'] = ['exec'],
): MockSandbox {
  const history: Array<{ cmd: string; opts?: ExecOptions }> = []
  const queue: QueuedResult[] = []
  let workspace: Workspace | null = null

  return {
    id: 'mock',
    placement: 'server',
    provider: 'mock',
    capabilities,
    history,
    queueResult(result) {
      queue.push(result)
    },
    async init(ctx) {
      workspace = ctx.workspace
    },
    async exec(cmd, opts) {
      if (!workspace) {
        throw new Error('MockSandbox not initialized')
      }

      history.push({ cmd, opts: cloneExecOptions(opts) })
      const queued = queue.shift()
      if (typeof queued === 'function') {
        return await queued(cmd, opts)
      }
      if (queued) {
        return materializeResult(queued)
      }
      return {
        ...createDefaultResult(),
        stdout: encoder.encode(`mock:${cmd}`),
      }
    },
  }
}
