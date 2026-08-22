import { findSandboxRuntimeModeDescriptor } from '@hachej/boring-agent/server'
import { BUILTIN_RUNTIME_MODE_IDS } from '@hachej/boring-agent/shared'

export function assertProductionAgentModeIsSafe(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return
  if (env.BORING_ALLOW_UNSAFE_AGENT_MODE === '1') return

  const mode = env.BORING_AGENT_MODE
  const descriptor = mode ? findSandboxRuntimeModeDescriptor(mode) : undefined
  if (!descriptor?.host.productionSafe) {
    const safeModes = BUILTIN_RUNTIME_MODE_IDS.filter(
      (candidate) => findSandboxRuntimeModeDescriptor(candidate)?.host.productionSafe,
    )
    throw new Error(
      `BORING_AGENT_MODE=${mode ?? '<unset>'} is not allowed in production full-app. ` +
        `Set BORING_AGENT_MODE=${safeModes.join(' or ')}, or set BORING_ALLOW_UNSAFE_AGENT_MODE=1 only for an explicitly approved deployment.`,
    )
  }
}
