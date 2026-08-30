import {
  lstatSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

import {
  attachSandboxProviderCleanupDebt,
  SandboxProviderError,
} from '../../shared/providerV1'

interface RootIdentity {
  readonly workspaceRoot: string
  readonly parentRealPath: string
  readonly parentDev: number
  readonly parentIno: number
  readonly rootDev: number
  readonly rootIno: number
}

function invalidRoot(): never {
  throw new SandboxProviderError('CONFIG_INVALID',
    'disposable workspace root must be one canonical non-symlinked child of a trusted local root')
}

function assertNoSymlinkAncestors(path: string): void {
  const root = parse(path).root
  const components = relative(root, path).split(sep).filter(Boolean)
  let cursor = root
  for (const component of components) {
    cursor = join(cursor, component)
    const stat = lstatSync(cursor)
    if (stat.isSymbolicLink() || !stat.isDirectory()) invalidRoot()
  }
}

/**
 * Local disposable mode is for trusted host work, not hostile multi-tenant
 * containment. It fails closed on every detectable ancestor/target alias and
 * revalidates inode identity immediately before recursive deletion.
 */
export function assertDisposableLocalRoot(workspaceRoot: string): string {
  const canonical = resolve(workspaceRoot)
  if (
    !workspaceRoot
    || !isAbsolute(workspaceRoot)
    || workspaceRoot !== canonical
    || parse(canonical).root === canonical
  ) invalidRoot()
  const parent = dirname(canonical)
  assertNoSymlinkAncestors(parent)
  if (realpathSync(parent) !== parent) invalidRoot()
  try {
    const target = lstatSync(canonical)
    if (target.isSymbolicLink() || !target.isDirectory() || realpathSync(canonical) !== canonical) invalidRoot()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return canonical
}

function captureRootIdentity(workspaceRoot: string): RootIdentity {
  assertDisposableLocalRoot(workspaceRoot)
  const parent = statSync(dirname(workspaceRoot))
  const root = lstatSync(workspaceRoot)
  if (root.isSymbolicLink() || !root.isDirectory()) invalidRoot()
  return {
    workspaceRoot,
    parentRealPath: realpathSync(dirname(workspaceRoot)),
    parentDev: parent.dev,
    parentIno: parent.ino,
    rootDev: root.dev,
    rootIno: root.ino,
  }
}

function revalidateRootIdentity(identity: RootIdentity): void {
  assertNoSymlinkAncestors(dirname(identity.workspaceRoot))
  const parent = statSync(dirname(identity.workspaceRoot))
  const root = lstatSync(identity.workspaceRoot)
  if (
    realpathSync(dirname(identity.workspaceRoot)) !== identity.parentRealPath
    || parent.dev !== identity.parentDev
    || parent.ino !== identity.parentIno
    || root.isSymbolicLink()
    || !root.isDirectory()
    || root.dev !== identity.rootDev
    || root.ino !== identity.rootIno
    || realpathSync(identity.workspaceRoot) !== identity.workspaceRoot
  ) invalidRoot()
}

export function createDisposableLocalDisposer(input: {
  workspaceRoot: string
  disposeWorkspace(): void
  disposeSandbox(): Promise<void>
}): () => Promise<void> {
  const identity = captureRootIdentity(input.workspaceRoot)
  let workspaceDisposed = false
  let sandboxDisposed = false
  let rootRemoved = false
  let inFlight: Promise<void> | undefined

  return (): Promise<void> => {
    if (workspaceDisposed && sandboxDisposed && rootRemoved) return Promise.resolve()
    if (inFlight) return inFlight
    const operation = (async () => {
      const failures: unknown[] = []
      if (!workspaceDisposed) {
        try { input.disposeWorkspace(); workspaceDisposed = true } catch (error) { failures.push(error) }
      }
      if (!sandboxDisposed) {
        try { await input.disposeSandbox(); sandboxDisposed = true } catch (error) { failures.push(error) }
      }
      if (!rootRemoved) {
        try {
          revalidateRootIdentity(identity)
          await rm(identity.workspaceRoot, { recursive: true, force: false })
          rootRemoved = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') rootRemoved = true
          else failures.push(error)
        }
      }
      if (failures.length) throw new AggregateError(failures, 'disposable local sandbox cleanup failed')
    })()
    inFlight = operation
    void operation.finally(() => { if (inFlight === operation) inFlight = undefined }).catch(() => undefined)
    return operation
  }
}

export function createDisposableLocalProviderLifecycle(providerId: 'direct' | 'bwrap') {
  const cleanups = new Set<() => Promise<void>>()
  const creates = new Set<Promise<void>>()
  let closed = false
  const settle = async (cleanup: () => Promise<void>): Promise<void> => {
    await cleanup(); cleanups.delete(cleanup)
  }
  return {
    get closed() { return closed },
    beginCreate(): () => void {
      let finish!: () => void
      const pending = new Promise<void>((resolve) => { finish = resolve })
      creates.add(pending)
      return () => { finish(); creates.delete(pending) }
    },
    own(cleanup: () => Promise<void>): void { cleanups.add(cleanup) },
    publish(cleanup: () => Promise<void>): void { cleanups.delete(cleanup) },
    async compensate(error: unknown, cleanup: () => Promise<void>): Promise<unknown> {
      try { await settle(cleanup) }
      catch (cleanupError) {
        throw attachSandboxProviderCleanupDebt(
          new AggregateError([error, cleanupError], `${providerId} sandbox creation cleanup failed`), () => settle(cleanup))
      }
      return error
    },
    async close(): Promise<void> {
      closed = true
      await Promise.allSettled([...creates])
      const failures = (await Promise.allSettled([...cleanups].map(settle))).filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason))
    },
  }
}
