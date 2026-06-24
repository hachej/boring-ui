import type { AgentCapabilityReadiness } from './readyStatus'
import { ReadyStatusTracker } from './readyStatus'
import type { RuntimeModeAdapter } from './mode'

export function createRuntimeReadyStatusTracker(
  modeAdapter: RuntimeModeAdapter,
  opts: {
    harnessReady: boolean
    capabilities?: Partial<AgentCapabilityReadiness>
  },
): ReadyStatusTracker {
  const readiness = modeAdapter.readiness
  const tracker = new ReadyStatusTracker({
    sandboxReady: readiness?.initialSandboxReady ?? true,
    harnessReady: opts.harnessReady,
    capabilities: {
      ...(readiness?.initialWorkspaceReadiness ? { workspace: readiness.initialWorkspaceReadiness } : {}),
      ...(opts.capabilities ?? {}),
    },
  })
  readiness?.onTrackerCreated?.(tracker)
  return tracker
}
