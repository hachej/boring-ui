import type {
  VercelSandboxClient,
  VercelSandboxHandle,
} from './resolveSandboxHandle'

export async function createDisposableSandboxHandle(input: {
  readonly vercel: VercelSandboxClient
  readonly sourceSnapshotId?: string
  readonly tarballUrl?: string
}): Promise<VercelSandboxHandle> {
  const base = { persistent: true, snapshotExpiration: 0 }
  if (input.sourceSnapshotId) {
    return await input.vercel.create({
      ...base,
      source: { type: 'snapshot', snapshotId: input.sourceSnapshotId },
    })
  }
  if (input.tarballUrl) {
    return await input.vercel.create({
      ...base,
      source: { type: 'tarball', url: input.tarballUrl },
    })
  }
  return await input.vercel.create(base)
}

function extractHttpStatus(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof statusCode === 'number') return statusCode
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status
  const responseStatus = (error as { response?: { status?: unknown } } | null)?.response?.status
  return typeof responseStatus === 'number' ? responseStatus : null
}

function isAlreadyAbsent(error: unknown): boolean {
  const status = extractHttpStatus(error)
  if (status === 404 || status === 410) return true
  const code = (error as { json?: { error?: { code?: unknown } } } | null)?.json?.error?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'not_found' || /already (?:absent|deleted)|sandbox (?:was )?not found/i.test(message)
}

/** Idempotent cleanup authority retained by the pair until remote deletion settles. */
export function createDisposableSandboxDisposer(input: {
  readonly sandbox: VercelSandboxHandle
  readonly disposeLocal: () => Promise<void> | void
}): () => Promise<void> {
  let localDisposed = false
  let remoteDeleted = false
  let disposed = false
  let inFlight: Promise<void> | undefined

  const disposeOnce = async (): Promise<void> => {
    const failures: unknown[] = []
    if (!localDisposed) {
      try {
        await input.disposeLocal()
        localDisposed = true
      } catch (error) {
        failures.push(error)
      }
    }
    if (!remoteDeleted) {
      try {
        await input.sandbox.delete()
        remoteDeleted = true
      } catch (error) {
        if (isAlreadyAbsent(error)) remoteDeleted = true
        else failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'disposable sandbox cleanup failed')
    }
    disposed = true
  }

  return async () => {
    if (disposed) return
    if (!inFlight) {
      const tracked = disposeOnce().finally(() => {
        if (inFlight === tracked) inFlight = undefined
      })
      inFlight = tracked
    }
    await inFlight
  }
}
