import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const VERCEL_PROVISIONING_CACHE_ROOT = '/tmp/boring-agent-cache'

export interface VercelProvisioningRuntimeLayout {
  workspaceRoot: string
  tmp: string
}

export interface VercelProvisioningExecResult {
  stdout?: string
  stderr?: string
}

export interface VercelProvisioningWorkspaceFs {
  exists(relPath: string): Promise<boolean>
  rm(relPath: string): Promise<void>
  mkdir(relPath: string): Promise<void>
  writeText(relPath: string, content: string): Promise<void>
  readText(relPath: string): Promise<string | null>
  copyFromHost(sourcePath: string | URL, relPath: string): Promise<void>
}

export type VercelProvisioningArtifactKind = 'node' | 'python'

export interface ProvisioningArtifactRequest {
  kind: VercelProvisioningArtifactKind
  id: string
  fingerprint: string
  source: string | URL
  outputPath: string
}

export interface ResolveVercelInstallSourceOptions {
  kind: VercelProvisioningArtifactKind
  id: string
  fingerprint: string
}

export interface ResolveVercelInstallSourceArgs {
  workspaceFs: Pick<VercelProvisioningWorkspaceFs, 'exists' | 'copyFromHost'>
  prepareArtifact: (request: ProvisioningArtifactRequest) => Promise<void>
  runtimeTmpDir: string
  source: string | URL
  opts: ResolveVercelInstallSourceOptions
}

export interface VercelProvisioningAdapter {
  mode: 'vercel-sandbox'
  exec(command: string, args: string[], opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }): Promise<VercelProvisioningExecResult | void>
  resolveInstallSource(source: string | URL, opts: ResolveVercelInstallSourceOptions): Promise<string>
  workspaceFs: VercelProvisioningWorkspaceFs
  getRuntimeCacheRoot(): string
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
