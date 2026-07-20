import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import type {
  SandboxProvisioningExecResultV1,
  SandboxProvisioningInstallSourceOptionsV1,
  SandboxProvisioningOperationsV1,
  SandboxProvisioningWorkspaceFsV1,
} from '../../shared/providerV1'

const execFileAsync = promisify(execFile)

export const VERCEL_PROVISIONING_CACHE_ROOT = '/tmp/boring-agent-cache'

export interface VercelProvisioningRuntimeLayout {
  workspaceRoot: string
  tmp: string
}

export type VercelProvisioningExecResult = SandboxProvisioningExecResultV1
export type VercelProvisioningWorkspaceFs = SandboxProvisioningWorkspaceFsV1

export type VercelProvisioningArtifactKind = 'node' | 'python'

export interface ProvisioningArtifactRequest {
  kind: VercelProvisioningArtifactKind
  id: string
  fingerprint: string
  source: string | URL
  outputPath: string
}

export async function packProvisioningArtifact(
  request: ProvisioningArtifactRequest,
): Promise<void> {
  const sourcePath = request.source instanceof URL
    ? fileURLToPath(request.source)
    : request.source
  await mkdir(dirname(request.outputPath), { recursive: true })

  if (request.kind === 'node') {
    const { stdout } = await execFileAsync('pnpm', [
      '--dir',
      sourcePath,
      'pack',
      '--pack-destination',
      dirname(request.outputPath),
    ], { maxBuffer: 1024 * 1024 * 20 })
    const packedName = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!packedName) throw new Error(`pnpm pack produced no artifact for ${sourcePath}`)
    const packedPath = isAbsolute(packedName)
      ? packedName
      : join(dirname(request.outputPath), packedName)
    await rename(packedPath, request.outputPath)
    return
  }

  await execFileAsync('tar', ['-czf', request.outputPath, '-C', sourcePath, '.'], {
    maxBuffer: 1024 * 1024 * 20,
  })
}

export type ResolveVercelInstallSourceOptions =
  SandboxProvisioningInstallSourceOptionsV1

export interface ResolveVercelInstallSourceArgs {
  workspaceFs: Pick<VercelProvisioningWorkspaceFs, 'exists' | 'copyFromHost'>
  prepareArtifact: (request: ProvisioningArtifactRequest) => Promise<void>
  runtimeTmpDir: string
  source: string | URL
  opts: ResolveVercelInstallSourceOptions
}

export type VercelProvisioningAdapter = SandboxProvisioningOperationsV1 & {
  readonly mode: 'vercel-sandbox'
}

export interface CreateVercelProvisioningAdapterOptions {
  runtimeLayout: VercelProvisioningRuntimeLayout
  workspaceFs: VercelProvisioningWorkspaceFs
  exec(command: string, args: string[], opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }): Promise<VercelProvisioningExecResult | void>
  prepareArtifact(request: ProvisioningArtifactRequest): Promise<void>
  resolveInstallSource?(args: ResolveVercelInstallSourceArgs): Promise<string>
  cacheRoot?: string
}

function artifactExtension(kind: VercelProvisioningArtifactKind): '.tgz' | '.tar.gz' {
  return kind === 'node' ? '.tgz' : '.tar.gz'
}

function provisioningArtifactName(
  kind: VercelProvisioningArtifactKind,
  id: string,
  fingerprint: string,
): string {
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '-')
  const safeFingerprint = fingerprint.replace(/^sha256:/, '')
  const formatVersion = kind === 'node' ? 'pnpm-pack-v2' : 'v1'
  return `${safeId}-${formatVersion}-${safeFingerprint}${artifactExtension(kind)}`
}

function toProvisioningArtifactError(
  error: unknown,
  details: { runtime: VercelProvisioningArtifactKind; id: string; artifact: string },
): Error {
  const message = error instanceof Error ? error.message : String(error)
  return Object.assign(new Error(`Workspace provisioning failed during adapter-artifact: ${message}`), {
    code: 'PROVISIONING_ARTIFACT_FAILED',
    cause: error,
    details: { phase: 'adapter-artifact', ...details },
  })
}

export async function resolveVercelArtifactInstallSource(
  args: ResolveVercelInstallSourceArgs,
): Promise<string> {
  const { kind, id, fingerprint } = args.opts
  const name = provisioningArtifactName(kind, id, fingerprint)
  const workspaceRel = `.boring-agent/tmp/${name}`

  if (!(await args.workspaceFs.exists(workspaceRel))) {
    const artifactDir = await mkdtemp(join(tmpdir(), 'boring-agent-artifact-'))
    const outputPath = join(artifactDir, name)
    try {
      await args.prepareArtifact({ kind, id, fingerprint, source: args.source, outputPath })
      await args.workspaceFs.copyFromHost(outputPath, workspaceRel)
    } catch (error) {
      throw toProvisioningArtifactError(error, { runtime: kind, id, artifact: workspaceRel })
    }
  }

  return `${args.runtimeTmpDir}/${name}`
}

export function createVercelProvisioningAdapter(
  options: CreateVercelProvisioningAdapterOptions,
): VercelProvisioningAdapter {
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
      return await (options.resolveInstallSource ?? resolveVercelArtifactInstallSource)({
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
