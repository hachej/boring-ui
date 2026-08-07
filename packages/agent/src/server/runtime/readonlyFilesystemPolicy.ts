import { createHash } from 'node:crypto'
import { ErrorCode } from '../../shared/error-codes'
import type {
  RuntimeFilesystemAccessDecision,
  RuntimeFilesystemCapability,
} from './mode'

export const RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID_CODE = ErrorCode.enum.RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID

export class RuntimeReadonlyFilesystemPolicyError extends Error {
  readonly code = RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID_CODE

  constructor() {
    super('readonly filesystem policy contains an invalid workspace-relative path')
    this.name = 'RuntimeReadonlyFilesystemPolicyError'
  }
}

export interface RuntimeReadonlyFilesystemPolicy {
  readonly readonlyPaths: readonly string[]
  readonly revision: string
}

function normalizePolicyPath(input: string, allowRoot = false, rejectSchemeLike = true): string {
  if (typeof input !== 'string' || (!allowRoot && input.length === 0) || input.includes('\0')) {
    throw new RuntimeReadonlyFilesystemPolicyError()
  }
  if (/^[A-Za-z]:[\\/]/.test(input) || (rejectSchemeLike && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input))) {
    throw new RuntimeReadonlyFilesystemPolicyError()
  }

  const normalized = input.replace(/\\/g, '/')
  if (normalized.startsWith('/')) throw new RuntimeReadonlyFilesystemPolicyError()

  const segments: string[] = []
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) throw new RuntimeReadonlyFilesystemPolicyError()
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  if (segments.length === 0 && !allowRoot) throw new RuntimeReadonlyFilesystemPolicyError()
  return segments.join('/')
}

function isEqualOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

export function normalizeRuntimeReadonlyFilesystemPolicy(
  paths: readonly string[],
): RuntimeReadonlyFilesystemPolicy {
  const sorted = [...new Set(paths.map((path) => normalizePolicyPath(path)))].sort()
  const readonlyPaths = sorted.filter((path) => !sorted.some((candidate) => (
    candidate.length < path.length && isEqualOrDescendant(path, candidate)
  )))
  return Object.freeze({
    readonlyPaths: Object.freeze(readonlyPaths),
    revision: `readonly-paths-v1-${createHash('sha256').update(JSON.stringify(readonlyPaths)).digest('hex')}`,
  })
}

function capabilities(input: {
  write: boolean
  createChild: boolean
  delete: boolean
  moveFrom: boolean
}): Readonly<Record<RuntimeFilesystemCapability, boolean>> {
  return Object.freeze({
    read: true,
    write: input.write,
    'create-child': input.createChild,
    delete: input.delete,
    'move-from': input.moveFrom,
  })
}

/** Resolve policy after the Workspace adapter has normalized/confined the path. */
export function resolveRuntimeReadonlyFilesystemAccess(
  policy: RuntimeReadonlyFilesystemPolicy,
  descriptor: { readonly filesystem: string; readonly normalizedPath: string },
): RuntimeFilesystemAccessDecision {
  const path = normalizePolicyPath(descriptor.normalizedPath, true, false)
  const insideReadonly = policy.readonlyPaths.some((prefix) => isEqualOrDescendant(path, prefix))
  const containsReadonly = policy.readonlyPaths.some((prefix) => path.length === 0 || isEqualOrDescendant(prefix, path))
  const resolvedCapabilities = capabilities({
    // Writing/replacing an ancestor could remove a protected descendant.
    write: !insideReadonly && !containsReadonly,
    // Creating an ancestor directory is non-destructive and keeps writable siblings usable.
    createChild: !insideReadonly,
    delete: !insideReadonly && !containsReadonly,
    moveFrom: !insideReadonly && !containsReadonly,
  })
  return Object.freeze({
    filesystem: descriptor.filesystem,
    normalizedPath: path,
    access: resolvedCapabilities.write ? 'readwrite' : 'readonly',
    capabilities: resolvedCapabilities,
  })
}
