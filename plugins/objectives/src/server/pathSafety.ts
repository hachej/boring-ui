import { lstat, mkdir, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

export class WorkspacePathEscapeError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Ensure `dirPath` (created if missing, with a restrictive mode) resolves —
 * after following any symlinks — to a location inside `workspaceRoot`.
 *
 * The workspace root is a trust boundary: a workspace-controlled `.boring`
 * directory could be replaced with a symlink pointing outside the
 * workspace to redirect the trusted host process into reading/writing
 * arbitrary host paths. `mkdir(..., { recursive: true })` alone does not
 * catch this because it happily "succeeds" through an existing symlink; the
 * containment check below runs `realpath` on the actual resolved directory
 * and rejects anything that lands outside `workspaceRoot`.
 *
 * This check is re-run on every load/save (not just once at startup) so a
 * symlink swapped in after the store was constructed is still caught.
 */
export async function ensureContainedDir(workspaceRoot: string, dirPath: string): Promise<string> {
  const resolvedRoot = resolve(workspaceRoot)
  await mkdir(dirPath, { recursive: true, mode: 0o700 })
  const realRoot = await realpath(resolvedRoot)
  const realDir = await realpath(dirPath)
  assertContained(realRoot, realDir, dirPath)
  return realDir
}

function assertContained(realRoot: string, realCandidate: string, requestedPath: string): void {
  const rel = relative(realRoot, realCandidate)
  if (rel === "" ) return
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new WorkspacePathEscapeError(
      `Resolved path escapes workspace root: ${requestedPath} -> ${realCandidate} (root ${realRoot})`,
    )
  }
}

/**
 * Reject `filePath` if it exists and is itself a symlink.
 *
 * `ensureContainedDir` verifies the *directory* is contained, but the store
 * file (`objectives.json`) is one path segment deeper: an attacker who can
 * write inside an otherwise-contained directory could replace the file
 * itself with a symlink pointing outside the workspace, redirecting reads
 * and (via the tmp+rename commit) writes to an arbitrary host path even
 * though the directory containment check passed. `lstat` (not `stat`) is
 * required here — `stat` follows the symlink and would report the resolved
 * target's metadata instead of detecting the link itself.
 *
 * A missing file is fine (ENOENT) — nothing to reject yet.
 */
export async function assertFileNotSymlink(filePath: string): Promise<void> {
  let stats
  try {
    stats = await lstat(filePath)
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return
    throw error
  }
  if (stats.isSymbolicLink()) {
    throw new WorkspacePathEscapeError(`Refusing to operate on a symlinked objective store file: ${filePath}`)
  }
}
