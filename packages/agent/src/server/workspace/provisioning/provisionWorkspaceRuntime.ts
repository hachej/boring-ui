import type { ProvisionWorkspaceRuntimeOptions, WorkspaceProvisioningResult } from './types'

export async function provisionWorkspaceRuntime(
  opts: ProvisionWorkspaceRuntimeOptions,
): Promise<WorkspaceProvisioningResult> {
  return {
    changed: false,
    env: {},
    pathEntries: [],
    skillPaths: [],
  }
}
