import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { ErrorCode, toProvisioningError } from './errors'
import type { ResolveInstallSourceOpts, WorkspaceProvisioningAdapter } from './types'

const execFileAsync = promisify(execFile)

type ProvisioningArtifactKind = 'node' | 'python'

/** What a per-mode packer receives to produce one artifact. `id`/`fingerprint`
 * are passed through (not used by the default packer, but part of the public
 * `prepareArtifact` contract — consumers key their own artifact paths off them). */
export interface ProvisioningArtifactRequest {
  kind: ProvisioningArtifactKind
  id: string
  fingerprint: string
  source: string | URL
  outputPath: string
}

/**
 * Provider-neutral materialization of an external install source into a
 * self-contained tarball. Both the `vercel-sandbox` and `local` (bwrap) modes
 * use this so that `npm install <.tgz>` / `uv pip install <.tar.gz>` extract a
 * real copy into the workspace instead of leaving a directory symlink that
 * escapes the workspace root (and is invisible inside a sandbox mount).
 *
 * - node: `pnpm pack` (honors the package's `files`/`bin`) → `.tgz`
 * - python: `tar -czf` of the source tree → `.tar.gz`
 */
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

/**
 * Stable, content-addressed file name for a packed install source. Shared by
 * every mode so the same source produces the same artifact name regardless of
 * provider.
 */
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

/**
 * The single materialization algorithm shared by every sandboxed mode (local
 * bwrap, vercel-sandbox): ensure the content-addressed artifact exists under
 * `.boring-agent/tmp/` in the workspace — packing it from `source` into a host
 * temp dir and copying it in only when absent — then return the runtime-visible
 * path. `prepareArtifact` is injected so each mode supplies its own packer (and
 * tests can stub it); `runtimeTmpDir` is the only per-mode value (the sandbox's
 * view of `.boring-agent/tmp`).
 */
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
      throw toProvisioningError(
        ErrorCode.enum.PROVISIONING_ARTIFACT_FAILED,
        'adapter-artifact',
        error,
        { runtime: kind, id, artifact: workspaceRel },
      )
    }
  }

  return `${args.runtimeTmpDir}/${name}`
}
