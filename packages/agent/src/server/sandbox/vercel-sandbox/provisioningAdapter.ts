import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { BoringAgentRuntimePaths } from '../../workspace/runtimeLayout'
import { ErrorCode, toProvisioningError } from '../../workspace/provisioning/errors'
import type {
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningExecResult,
} from '../../workspace/provisioning'
import { provisioningArtifactName } from '../../workspace/provisioning/packArtifact'

export const VERCEL_PROVISIONING_CACHE_ROOT = '/tmp/boring-agent-cache'

export interface VercelProvisioningArtifactRequest {
  kind: 'node' | 'python'
  id: string
  fingerprint: string
  source: string | URL
  outputPath: string
}

export interface CreateVercelProvisioningAdapterOptions {
  runtimeLayout: BoringAgentRuntimePaths
  workspaceFs: WorkspaceProvisioningAdapter['workspaceFs']
  exec(command: string, args: string[], opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }): Promise<WorkspaceProvisioningExecResult | void>
  prepareArtifact(request: VercelProvisioningArtifactRequest): Promise<void>
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
      const name = provisioningArtifactName(opts.kind, opts.id, opts.fingerprint)
      const workspaceRel = `.boring-agent/tmp/${name}`
      const runtimePath = `${options.runtimeLayout.tmp}/${name}`

      if (!(await options.workspaceFs.exists(workspaceRel))) {
        const artifactDir = await mkdtemp(join(tmpdir(), 'boring-agent-vercel-artifact-'))
        const outputPath = join(artifactDir, name)
        try {
          await options.prepareArtifact({
            kind: opts.kind,
            id: opts.id,
            fingerprint: opts.fingerprint,
            source,
            outputPath,
          })
          await options.workspaceFs.copyFromHost(outputPath, workspaceRel)
        } catch (error) {
          throw toProvisioningError(
            ErrorCode.enum.PROVISIONING_ARTIFACT_FAILED,
            'adapter-artifact',
            error,
            { runtime: opts.kind, id: opts.id, artifact: workspaceRel },
          )
        }
      }

      return runtimePath
    },
    workspaceFs: options.workspaceFs,
    getRuntimeCacheRoot() {
      return options.cacheRoot ?? VERCEL_PROVISIONING_CACHE_ROOT
    },
  }
}
