import { rm } from 'node:fs/promises'
import { isAbsolute, parse, resolve } from 'node:path'

import { SandboxProviderError, type WorkspaceSandboxPairV1 } from '../../shared/providerV1'

export function assertDisposableLocalRoot(workspaceRoot: string): string {
  const canonical = resolve(workspaceRoot)
  if (
    !workspaceRoot
    || !isAbsolute(workspaceRoot)
    || workspaceRoot !== canonical
    || parse(canonical).root === canonical
  ) {
    throw new SandboxProviderError(
      'CONFIG_INVALID',
      'disposable workspace root must be one canonical absolute non-root path',
    )
  }
  return canonical
}

export function createDisposableLocalDisposer(input: {
  workspaceRoot: string
  disposeWorkspace(): void
  disposeSandbox(): Promise<void>
}): () => Promise<void> {
  const workspaceRoot = assertDisposableLocalRoot(input.workspaceRoot)
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
        try { await rm(workspaceRoot, { recursive: true, force: true }); rootRemoved = true }
        catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, 'disposable local sandbox cleanup failed')
    })()
    inFlight = operation
    void operation.finally(() => { if (inFlight === operation) inFlight = undefined }).catch(() => undefined)
    return operation
  }
}

/** Owns only the exact provider context root; failed steps remain retryable. */
export function createDisposableLocalPair(input: {
  workspaceRoot: string
  pair: Omit<WorkspaceSandboxPairV1, 'dispose'>
  disposeWorkspace(): void
  disposeSandbox(): Promise<void>
}): WorkspaceSandboxPairV1 {
  return { ...input.pair, dispose: createDisposableLocalDisposer(input) }
}

export async function cleanupDisposableLocalCreateFailure(input: {
  workspaceRoot: string
  disposeWorkspace(): void
  disposeSandbox(): Promise<void>
}): Promise<void> {
  await createDisposableLocalDisposer(input)()
}
