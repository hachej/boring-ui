import {
  BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS,
  resolveSandboxRuntimeModeDescriptor,
} from '@hachej/boring-sandbox/providers/registry'

export function assertProductionAgentModeIsSafe(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return
  if (env.BORING_ALLOW_UNSAFE_AGENT_MODE === '1') return

  const mode = env.BORING_AGENT_MODE
  const descriptor = mode
    ? (() => {
        try { return resolveSandboxRuntimeModeDescriptor(mode) }
        catch { return undefined }
      })()
    : undefined
  if (!descriptor?.host.productionSafe) {
    const safeModes = BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS
      .filter((candidate) => candidate.host.productionSafe)
      .map((candidate) => candidate.id)
    throw new Error(
      `BORING_AGENT_MODE=${mode ?? '<unset>'} is not allowed in production full-app. ` +
        `Set BORING_AGENT_MODE=${safeModes.join(' or ')}, or set BORING_ALLOW_UNSAFE_AGENT_MODE=1 only for an explicitly approved deployment.`,
    )
  }
}
