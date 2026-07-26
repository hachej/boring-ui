import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { RuntimeFilesystemCapability } from '@hachej/boring-agent/shared'

import type { ReadonlyWorkspacePolicyV1 } from '../../shared/providerV1'
import { validatePath } from './paths'

class ProviderReadonlyFilesystemMutationError extends Error {
  readonly code = 'readonly' as const
  readonly statusCode = 403 as const
  readonly filesystem = 'user' as const

  constructor(readonly operation: RuntimeFilesystemCapability) {
    super('user binding is readonly')
    this.name = 'ReadonlyFilesystemMutationError'
  }
}

interface RootMutationState {
  readonly canonicalRoot: string
  policy?: ReadonlyWorkspacePolicyV1
  protectedPrefixes: readonly string[]
  policyUpgrade?: Promise<void>
  references: number
  tail: Promise<void>
}

export interface NodeWorkspaceMutationGuard {
  readonly policy?: ReadonlyWorkspacePolicyV1
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
  assertAllowed(
    operation: RuntimeFilesystemCapability,
    workspaceRelativePaths: readonly string[],
  ): Promise<void>
  release(): void
}

const statesByRoot = new Map<string, Promise<RootMutationState>>()

function invalidPolicy(): Error {
  return Object.assign(new Error('readonly workspace policy is invalid'), {
    code: 'RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID',
  })
}

function normalizePolicyPath(path: string): string {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || isAbsolute(path)) {
    throw invalidPolicy()
  }
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw invalidPolicy()
  return segments.join('/')
}

function normalizeRelativePath(root: string, path: string): string {
  const absolute = validatePath(root, path)
  const normalized = relative(resolve(root), absolute).split(sep).join('/')
  return normalized === '.' ? '' : normalized
}

function isEqualOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

function pathsIntersect(left: string, right: string): boolean {
  return isEqualOrDescendant(left, right) || isEqualOrDescendant(right, left)
}

function collapsePrefixes(prefixes: readonly string[]): readonly string[] {
  const sorted = [...new Set(prefixes)].sort()
  return Object.freeze(sorted.filter((path) => !sorted.some((candidate) => (
    candidate !== path && candidate.length < path.length && isEqualOrDescendant(path, candidate)
  ))))
}

async function canonicalRelativePath(state: RootMutationState, workspaceRelativePath: string): Promise<string> {
  const absolute = validatePath(state.canonicalRoot, workspaceRelativePath)
  const suffix: string[] = []
  let existing = absolute
  while (true) {
    try {
      await lstat(existing)
      break
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      const parent = dirname(existing)
      if (parent === existing) throw error
      suffix.unshift(relative(parent, existing))
      existing = parent
    }
  }
  const realExisting = await realpath(existing)
  const projected = resolve(realExisting, ...suffix)
  const canonicalRelative = relative(state.canonicalRoot, projected)
  if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) {
    throw Object.assign(new Error('Resolved path escapes workspace root'), {
      statusCode: 400,
      reason: 'symlink-escape',
      requestedPath: workspaceRelativePath,
    })
  }
  return canonicalRelative.split(sep).join('/')
}

async function buildProtectedPrefixes(
  canonicalRoot: string,
  policy: ReadonlyWorkspacePolicyV1 | undefined,
): Promise<readonly string[]> {
  if (!policy) return Object.freeze([])
  if (!policy.revision.trim()) throw invalidPolicy()
  const provisional: RootMutationState = {
    canonicalRoot,
    policy,
    protectedPrefixes: [],
    references: 0,
    tail: Promise.resolve(),
  }
  const prefixes: string[] = []
  for (const input of policy.readonlyPaths) {
    const lexical = normalizePolicyPath(input)
    prefixes.push(lexical)
    prefixes.push(await canonicalRelativePath(provisional, lexical))
  }
  return collapsePrefixes(prefixes)
}

async function canonicalPlannedRoot(root: string): Promise<string> {
  const resolvedRoot = resolve(root)
  const suffix: string[] = []
  let existing = resolvedRoot
  while (true) {
    try {
      const canonicalExisting = await realpath(existing)
      return resolve(canonicalExisting, ...suffix)
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      const parent = dirname(existing)
      if (parent === existing) throw error
      suffix.unshift(relative(parent, existing))
      existing = parent
    }
  }
}

export async function acquireNodeWorkspaceMutationGuard(
  root: string,
  policy: ReadonlyWorkspacePolicyV1 | undefined,
): Promise<NodeWorkspaceMutationGuard> {
  const canonicalRoot = await canonicalPlannedRoot(root)
  const frozenPolicy = policy
    ? Object.freeze({
        readonlyPaths: Object.freeze(policy.readonlyPaths.map(normalizePolicyPath)),
        revision: policy.revision,
      })
    : undefined
  let statePromise = statesByRoot.get(canonicalRoot)
  if (!statePromise) {
    statePromise = buildProtectedPrefixes(canonicalRoot, frozenPolicy).then((protectedPrefixes) => ({
      canonicalRoot,
      policy: frozenPolicy,
      protectedPrefixes,
      references: 0,
      tail: Promise.resolve(),
    }))
    statesByRoot.set(canonicalRoot, statePromise)
  }
  let state: RootMutationState
  try {
    state = await statePromise
  } catch (error) {
    if (statesByRoot.get(canonicalRoot) === statePromise) statesByRoot.delete(canonicalRoot)
    throw error
  }
  if (frozenPolicy && !state.policy) {
    if (!state.policyUpgrade) {
      const upgrade = buildProtectedPrefixes(canonicalRoot, frozenPolicy)
        .then((protectedPrefixes) => {
          state!.policy = frozenPolicy
          state!.protectedPrefixes = protectedPrefixes
        })
      state.policyUpgrade = upgrade
      void upgrade.catch(() => {
        if (state!.policyUpgrade === upgrade) state!.policyUpgrade = undefined
      })
    }
    try {
      await state.policyUpgrade
    } catch {
      throw invalidPolicy()
    }
  }
  if (frozenPolicy && (!state.policy
    || state.policy.revision !== frozenPolicy.revision
    || JSON.stringify(state.policy.readonlyPaths) !== JSON.stringify(frozenPolicy.readonlyPaths))) {
    throw invalidPolicy()
  }
  state.references += 1
  let released = false

  return {
    policy: state.policy,
    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      let release!: () => void
      const predecessor = state!.tail
      state!.tail = new Promise<void>((resolveTail) => { release = resolveTail })
      await predecessor
      try {
        return await operation()
      } finally {
        release()
      }
    },
    async assertAllowed(operation, workspaceRelativePaths) {
      if (!state!.policy) return
      for (const requestedPath of workspaceRelativePaths) {
        const lexical = normalizeRelativePath(state!.canonicalRoot, requestedPath)
        const canonical = await canonicalRelativePath(state!, requestedPath)
        if (state!.protectedPrefixes.some((prefix) => (
          pathsIntersect(lexical, prefix) || pathsIntersect(canonical, prefix)
        ))) {
          throw new ProviderReadonlyFilesystemMutationError(operation)
        }
      }
    },
    release() {
      if (released) return
      released = true
      state!.references -= 1
      // Policy and FIFO lock identity are process-lifetime root state. Runtime
      // disposal must never create an unguarded re-projection or a second lock.
    },
  }
}
