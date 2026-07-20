import type { BashOperations } from '@mariozechner/pi-coding-agent'

import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import { mergeRuntimeProvisioningEnv, type RuntimeProvisioningOptions } from '../../runtime/env'

export const REMOTE_SAFE_DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin'

function mergeRemoteBashRuntimeEnv(
  runtime: RuntimeProvisioningOptions | undefined,
  executionRuntimeEnv: Record<string, string> | undefined,
  defaultPath: string,
): Record<string, string | undefined> | undefined {
  const { PATH: executionPath, ...executionEnv } = executionRuntimeEnv ?? {}
  return mergeRuntimeProvisioningEnv(runtime, {
    ...executionEnv,
    PATH: executionPath ? `${executionPath}:${defaultPath}` : defaultPath,
  })
}

export function remoteSandboxBashOps(sandbox: Sandbox, workspace: Workspace | undefined, opts: {
  defaultPath?: string
  mergeEnv?: (env: Record<string, string | undefined> | undefined) => Record<string, string | undefined> | undefined
  runtime?: RuntimeProvisioningOptions
  executionRuntimeEnv?: Record<string, string>
} = {}): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      const effectiveEnv = opts.mergeEnv
        ? opts.mergeEnv(env)
        : opts.runtime || opts.executionRuntimeEnv
          ? mergeRemoteBashRuntimeEnv(opts.runtime, opts.executionRuntimeEnv, opts.defaultPath ?? REMOTE_SAFE_DEFAULT_PATH)
          : env
      const filteredEnv = effectiveEnv
        ? Object.fromEntries(Object.entries(effectiveEnv).filter((e): e is [string, string] => e[1] != null))
        : undefined
      return sandbox.exec(command, {
        cwd,
        env: filteredEnv,
        signal,
        timeoutMs: timeout ? timeout * 1000 : undefined,
        onStdout: (chunk) => onData(Buffer.from(chunk)),
        onStderr: (chunk) => onData(Buffer.from(chunk)),
      }).then((result) => {
        if (result.exitCode === 0 && workspace && typeof (workspace as any).notifyExternalChange === 'function') {
          (workspace as any).notifyExternalChange({ type: 'resync-required', reason: 'bash_tool_mutation' })
        }
        return { exitCode: result.exitCode }
      })
    },
  }
}
