import { lstat, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export type PathRejectReason =
  | 'path-escape'
  | 'absolute-path'
  | 'null-byte'
  | 'symlink-escape'

export interface PathValidationError extends Error {
  statusCode: number
  reason: PathRejectReason
  requestedPath: string
}

function createPathValidationError(
  reason: PathRejectReason,
  requestedPath: string,
  message: string,
): PathValidationError {
  return Object.assign(new Error(message), {
    statusCode: 400,
    reason,
    requestedPath,
  })
}

function normalizeForTraversalChecks(requestedPath: string): string {
  let decoded = requestedPath
  try {
    decoded = decodeURIComponent(requestedPath)
  } catch {
    // Keep raw string when decode fails; validation still runs safely.
  }

  return decoded.replace(/\\/g, '/')
}

function hasTraversalSegment(requestedPath: string): boolean {
  return requestedPath.split('/').some((segment) => segment === '..' || segment.startsWith('..'))
}

function isWindowsAbsolutePath(requestedPath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(requestedPath) || requestedPath.startsWith('\\\\')
}

/**
 * Validate and resolve a user-provided relative path under workspaceRoot.
 */
export function validatePath(workspaceRoot: string, relPath: string): string {
  if (relPath.includes('\0')) {
    throw createPathValidationError('null-byte', relPath, 'Null byte in path')
  }

  const normalized = normalizeForTraversalChecks(relPath)

  if (
    isAbsolute(relPath) ||
    normalized.startsWith('/') ||
    isWindowsAbsolutePath(relPath) ||
    isWindowsAbsolutePath(normalized)
  ) {
    throw createPathValidationError('absolute-path', relPath, 'Absolute paths are not allowed')
  }

  if (
    hasTraversalSegment(normalized) ||
    normalized.startsWith('~') ||
    normalized.startsWith('$') ||
    /[\r\n]/.test(normalized)
  ) {
    throw createPathValidationError('path-escape', relPath, 'Path escapes workspace root')
  }

  const resolvedRoot = resolve(workspaceRoot)
  const resolvedPath = resolve(workspaceRoot, relPath)

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw createPathValidationError('path-escape', relPath, 'Path escapes workspace root')
  }

  return resolvedPath
}

/**
 * Resolve symlinks and ensure candidate path remains under workspaceRoot.
 */
export async function assertRealPathWithinWorkspace(
  workspaceRoot: string,
  absPath: string,
): Promise<void> {
  const realRoot = await realpath(resolve(workspaceRoot))
  const realCandidate = await realpath(absPath)
  const rel = relative(realRoot, realCandidate)

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw createPathValidationError(
      'symlink-escape',
      absPath,
      'Resolved path escapes workspace root',
    )
  }
}

/**
 * Validate an existing path and enforce realpath boundary.
 */
export async function ensureExistingWorkspacePath(
  workspaceRoot: string,
  relPath: string,
): Promise<string> {
  const absPath = validatePath(workspaceRoot, relPath)
  await assertRealPathWithinWorkspace(workspaceRoot, absPath)
  await stat(absPath)
  return absPath
}

/**
 * Validate a target path and ensure its existing parent stays inside workspace root.
 */
export async function ensureWritableWorkspacePath(
  workspaceRoot: string,
  relPath: string,
): Promise<string> {
  const absPath = validatePath(workspaceRoot, relPath)
  const parentPath = dirname(absPath)

  await stat(parentPath)
  await assertRealPathWithinWorkspace(workspaceRoot, parentPath)

  try {
    const pathStat = await lstat(absPath)
    if (pathStat.isSymbolicLink()) {
      throw createPathValidationError('symlink-escape', relPath, 'Target path is a symlink')
    }
  } catch (error: unknown) {
    const code = (error as { code?: string }).code
    if (code !== 'ENOENT') {
      throw error
    }
  }

  return absPath
}
