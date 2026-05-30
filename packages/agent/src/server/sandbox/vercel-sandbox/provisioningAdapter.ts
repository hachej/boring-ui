import type { BoringAgentRuntimePaths } from '../../workspace/runtimeLayout'
import type {
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningExecResult,
} from '../../workspace/provisioning'
import {
  type ProvisioningArtifactRequest,
  resolveArtifactInstallSource,
} from '../../workspace/provisioning/packArtifact'

export const VERCEL_PROVISIONING_CACHE_ROOT = '/tmp/boring-agent-cache'

/** @deprecated Use {@link ProvisioningArtifactRequest}. Retained for the public export surface. */
export type VercelProvisioningArtifactRequest = ProvisioningArtifactRequest

export interface CreateVercelProvisioningAdapterOptions {
  runtimeLayout: BoringAgentRuntimePaths
  workspaceFs: WorkspaceProvisioningAdapter['workspaceFs']
  exec(command: string, args: string[], opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }): Promise<WorkspaceProvisioningExecResult | void>
  prepareArtifact(request: ProvisioningArtifactRequest): Promise<void>
  cacheRoot?: string
}

export function createVercelProvisioningAdapter(
  options: CreateVercelProvisioningAdapterOptions,
): WorkspaceProvisioningAdapter {
  return {
    mode: 'vercel-sandbox',
    async exec(command, args, opts) {
      return await options.exec(command, args, {
        cwd: opts?.cwd ?? options.runtimeLayout.workspaceRoot,
        env: opts?.env,
        timeoutMs: opts?.timeoutMs,
      })
    },
    async resolveInstallSource(source, opts) {
      return await resolveArtifactInstallSource({
        workspaceFs: options.workspaceFs,
        prepareArtifact: options.prepareArtifact,
        runtimeTmpDir: options.runtimeLayout.tmp,
        source,
        opts,
      })
    },
    workspaceFs: options.workspaceFs,
    getRuntimeCacheRoot() {
      return options.cacheRoot ?? VERCEL_PROVISIONING_CACHE_ROOT
    },
  }
}
