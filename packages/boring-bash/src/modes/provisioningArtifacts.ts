import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import type { ResolveInstallSourceOpts, WorkspaceProvisioningAdapter } from '@hachej/boring-agent/server'

const execFileAsync = promisify(execFile)
const PROVISIONING_ARTIFACT_FAILED = 'PROVISIONING_ARTIFACT_FAILED'

type ProvisioningArtifactKind = 'node' | 'python'

export interface ProvisioningArtifactRequest {
  kind: ProvisioningArtifactKind
  id: string
  fingerprint: string
  source: string | URL
  outputPath: string
}

class ProvisioningArtifactError extends Error {
  readonly code = PROVISIONING_ARTIFACT_FAILED
  readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown>, cause?: unknown) {
    super(message, { cause })
    this.name = 'ProvisioningError'
    this.details = details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toProvisioningArtifactError(
  phase: string,
  error: unknown,
  details: Record<string, unknown> = {},
): Error {
  if (
    error instanceof Error
    && isRecord(error)
    && typeof error.code === 'string'
    && error.code.startsWith('PROVISIONING_')
  ) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  return new ProvisioningArtifactError(
    `Workspace provisioning failed during ${phase}: ${message}`,
    { phase, ...details },
    error,
  )
}

export async function packProvisioningArtifact(request: ProvisioningArtifactRequest): Promise<void> {
  const sourcePath = request.source instanceof URL ? fileURLToPath(request.source) : request.source
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
    const packedPath = isAbsolute(packedName) ? packedName : join(dirname(request.outputPath), packedName)
    await rename(packedPath, request.outputPath)
    return
  }

  await execFileAsync('tar', ['-czf', request.outputPath, '-C', sourcePath, '.'], {
    maxBuffer: 1024 * 1024 * 20,
  })
}

function artifactExtension(kind: ProvisioningArtifactKind): '.tgz' | '.tar.gz' {
  return kind === 'node' ? '.tgz' : '.tar.gz'
}

function provisioningArtifactName(
  kind: ProvisioningArtifactKind,
  id: string,
  fingerprint: string,
): string {
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '-')
  const safeFingerprint = fingerprint.replace(/^sha256:/, '')
  const formatVersion = kind === 'node' ? 'pnpm-pack-v2' : 'v1'
  return `${safeId}-${formatVersion}-${safeFingerprint}${artifactExtension(kind)}`
}

export async function resolveArtifactInstallSource(args: {
  workspaceFs: Pick<WorkspaceProvisioningAdapter['workspaceFs'], 'exists' | 'copyFromHost'>
  prepareArtifact: (request: ProvisioningArtifactRequest) => Promise<void>
  runtimeTmpDir: string
  source: string | URL
  opts: ResolveInstallSourceOpts
}): Promise<string> {
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
      throw toProvisioningArtifactError(
        'adapter-artifact',
        error,
        { runtime: kind, id, artifact: workspaceRel },
      )
    }
  }

  return `${args.runtimeTmpDir}/${name}`
}
