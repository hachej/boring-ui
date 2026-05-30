import { execFile } from 'node:child_process'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ProvisioningArtifactKind = 'node' | 'python'

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
export async function packProvisioningArtifact(request: {
  kind: ProvisioningArtifactKind
  source: string | URL
  outputPath: string
}): Promise<void> {
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
export function provisioningArtifactName(
  kind: ProvisioningArtifactKind,
  id: string,
  fingerprint: string,
): string {
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '-')
  const safeFingerprint = fingerprint.replace(/^sha256:/, '')
  const formatVersion = kind === 'node' ? 'pnpm-pack-v2' : 'v1'
  return `${safeId}-${formatVersion}-${safeFingerprint}${artifactExtension(kind)}`
}
