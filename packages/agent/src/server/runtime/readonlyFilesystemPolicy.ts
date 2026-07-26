import { digestRuntimeIdentityValue } from '../agent-host/runtimeScopeIdentity'
import type {
  RuntimeFilesystemAccessDecision,
  RuntimeFilesystemCapability,
} from './mode'

export const RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID_CODE = 'RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID'

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

function stableRevision(values: readonly string[]): string {
  return `readonly-paths-v1-${digestRuntimeIdentityValue([...values])}`
}

function normalizePolicyPath(input: string, allowRoot = false, rejectSchemeLike = true): string {
  if (typeof input !== 'string' || (!allowRoot && input.length === 0) || input.includes('\0')) {
    throw new RuntimeReadonlyFilesystemPolicyError()
  }
  if (/^[A-Za-z]:[\\/]/.test(input) || (rejectSchemeLike && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input))) {
    throw new RuntimeReadonlyFilesystemPolicyError()
  }

  const withForwardSlashes = input.replace(/\\/g, '/')
  if (withForwardSlashes.startsWith('/')) throw new RuntimeReadonlyFilesystemPolicyError()

  const segments: string[] = []
  for (const segment of withForwardSlashes.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) throw new RuntimeReadonlyFilesystemPolicyError()
      segments.pop()
      continue
    }
    segments.push(segment)
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
  const sorted = [...new Set(paths.map((path) => normalizePolicyPath(path)))].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ))
  const readonlyPaths = sorted.filter((path, index) => !sorted.some((candidate, candidateIndex) => (
    candidateIndex !== index
      && candidate.length < path.length
      && isEqualOrDescendant(path, candidate)
  )))
  return Object.freeze({
    readonlyPaths: Object.freeze(readonlyPaths),
    revision: stableRevision(readonlyPaths),
  })
}

function capabilityRecord(input: {
  readonly write: boolean
  readonly createChild: boolean
  readonly delete: boolean
  readonly moveFrom: boolean
}): Readonly<Record<RuntimeFilesystemCapability, boolean>> {
  return Object.freeze({
    read: true,
    write: input.write,
    'create-child': input.createChild,
    delete: input.delete,
    'move-from': input.moveFrom,
  })
}

/**
 * Resolve the host ceiling for one provider-normalized relative path. The
 * provider remains responsible for canonical path and symlink validation.
 */
export function resolveRuntimeReadonlyFilesystemAccess(
  policy: RuntimeReadonlyFilesystemPolicy,
  descriptor: { readonly filesystem: string; readonly normalizedPath: string },
): RuntimeFilesystemAccessDecision {
  // A colon is legal in a workspace filename (for example `backup:2026.tar`).
  // Scheme-like strings are rejected when authoring policy, while access
  // queries reject only absolute/drive, NUL, and escaping paths.
  const path = normalizePolicyPath(descriptor.normalizedPath, true, false)
  const insideReadonly = policy.readonlyPaths.some((prefix) => isEqualOrDescendant(path, prefix))
  const containsReadonly = policy.readonlyPaths.some((prefix) => path.length === 0 || isEqualOrDescendant(prefix, path))
  const capabilities = capabilityRecord({
    write: !insideReadonly,
    createChild: !insideReadonly,
    delete: !insideReadonly && !containsReadonly,
    moveFrom: !insideReadonly && !containsReadonly,
  })
  return Object.freeze({
    filesystem: descriptor.filesystem,
    normalizedPath: path,
    access: capabilities.write ? 'readwrite' : 'readonly',
    capabilities,
  })
}
