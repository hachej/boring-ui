import { createHash } from 'node:crypto'

import { SandboxProviderError } from '../../shared/providerV1'
import {
  createDisposableSandboxDisposer,
  createDisposableSandboxHandle,
} from './disposableSandboxLifecycle'
import { extractHttpStatus } from './httpError'
import {
  normalizedLifecycleErrorCode,
  type VercelLifecycleLogger,
} from './lifecycleTelemetry'
import type {
  VercelSandboxClient,
  VercelSandboxHandle,
} from './resolveSandboxHandle'

function assertIdentity(input: {
  handle: VercelSandboxHandle
  expectedName: string
  expectedSnapshotId?: string
  expectedSandboxId?: string
}): void {
  if (
    input.handle.name !== input.expectedName
    || (input.expectedSnapshotId !== undefined
      && input.handle.sourceSnapshotId !== input.expectedSnapshotId)
    || (input.expectedSandboxId !== undefined
      && input.handle.sandboxId !== input.expectedSandboxId)
  ) throw new SandboxProviderError('CONFIG_INVALID', 'disposable Vercel correlation identity does not match')
}

export interface DisposableVercelCreation {
  readonly name: string
  resolveHandle(input: {
    readonly tarballUrl?: string
    readonly disposeLocal: () => Promise<void>
  }): Promise<VercelSandboxHandle>
  disposePair(): Promise<void>
  publish(): void
  fail(error: unknown): Promise<(() => Promise<void>) | undefined>
}

export function createDisposableVercelLifecycleManager(options: {
  readonly sourceSnapshotId?: string
  readonly timeoutMs: number
  readonly snapshotExpirationMs: number
  readonly logger: VercelLifecycleLogger
  readonly normalizeError: (error: unknown) => Error
  readonly isDefinitiveCreateRejection: (error: unknown) => boolean
}) {
  const unpublishedCleanups = new Set<() => Promise<void>>()
  const reservedNames = new Set<string>()
  const publishedNames = new Set<string>()

  const settle = async (cleanup: () => Promise<void>): Promise<void> => {
    await cleanup()
    unpublishedCleanups.delete(cleanup)
  }

  return {
    async close(): Promise<void> {
      const results = await Promise.allSettled([...unpublishedCleanups].map(settle))
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Vercel disposable cleanup failed')
    },

    begin(input: {
      readonly workspaceId: string
      readonly sessionId: string
      readonly requestId?: string
      readonly vercel: VercelSandboxClient
    }): DisposableVercelCreation {
      const name = `boring-lease-${createHash('sha256')
        .update(`${input.workspaceId}:${input.sessionId}:${input.requestId ?? input.sessionId}`)
        .digest('hex')
        .slice(0, 40)}`
      if (reservedNames.has(name) || publishedNames.has(name)) {
        throw new SandboxProviderError('CONFIG_INVALID', 'disposable Vercel request identity is already owned')
      }
      reservedNames.add(name)

      let returnedCleanup: (() => Promise<void>) | undefined
      let returnedSandboxId: string | undefined
      let ambiguityCleanup: (() => Promise<void>) | undefined

      ambiguityCleanup = async () => {
        if (returnedCleanup && unpublishedCleanups.has(returnedCleanup)) {
          throw new SandboxProviderError('VERCEL_API_ERROR', 'returned Vercel sandbox cleanup remains pending')
        }
        try {
          const candidate = await input.vercel.get({ name, resume: false })
          assertIdentity({
            handle: candidate,
            expectedName: name,
            expectedSnapshotId: options.sourceSnapshotId,
            expectedSandboxId: returnedSandboxId,
          })
          await candidate.delete()
        } catch (error) {
          const status = extractHttpStatus(error)
          if (status !== 404 && status !== 410) throw options.normalizeError(error)
          if (!returnedCleanup) {
            throw new SandboxProviderError('VERCEL_API_ERROR', 'disposable Vercel create reconciliation remains pending')
          }
        }
        reservedNames.delete(name)
        unpublishedCleanups.delete(ambiguityCleanup!)
      }
      unpublishedCleanups.add(ambiguityCleanup)

      const cleanupCandidates = () => [returnedCleanup, ambiguityCleanup] as const
      const cleanup = async () => {
        for (const candidate of cleanupCandidates()) {
          if (candidate && unpublishedCleanups.has(candidate)) await settle(candidate)
        }
      }

      return {
        name,
        async resolveHandle({ tarballUrl, disposeLocal }) {
          const handle = await createDisposableSandboxHandle({
            vercel: input.vercel,
            sourceSnapshotId: options.sourceSnapshotId,
            tarballUrl,
            name,
            timeoutMs: options.timeoutMs,
            snapshotExpirationMs: options.snapshotExpirationMs,
          })
          returnedSandboxId = handle.sandboxId
          const disposeRemote = createDisposableSandboxDisposer({ sandbox: handle, disposeLocal })
          returnedCleanup = async () => {
            await disposeRemote()
            if (!ambiguityCleanup) {
              reservedNames.delete(name)
              publishedNames.delete(name)
            }
          }
          unpublishedCleanups.add(returnedCleanup)
          assertIdentity({ handle, expectedName: name, expectedSnapshotId: options.sourceSnapshotId })
          const lookedUp = await input.vercel.get({ name, resume: false })
          assertIdentity({
            handle: lookedUp,
            expectedName: name,
            expectedSnapshotId: options.sourceSnapshotId,
            expectedSandboxId: handle.sandboxId,
          })
          unpublishedCleanups.delete(ambiguityCleanup!)
          ambiguityCleanup = undefined
          return handle
        },
        async disposePair() {
          if (!returnedCleanup) throw new TypeError('disposable sandbox cleanup authority is unavailable')
          await returnedCleanup()
        },
        publish() {
          if (!returnedCleanup) throw new TypeError('disposable sandbox cleanup authority is unavailable')
          unpublishedCleanups.delete(returnedCleanup)
          reservedNames.delete(name)
          publishedNames.add(name)
        },
        async fail(error) {
          if (!returnedCleanup && ambiguityCleanup && options.isDefinitiveCreateRejection(error)) {
            unpublishedCleanups.delete(ambiguityCleanup)
            reservedNames.delete(name)
            ambiguityCleanup = undefined
          }
          try {
            await cleanup()
          } catch (cleanupError) {
            options.logger.warn?.('[vercel-sandbox:mode] disposable setup cleanup failed', {
              errorCode: normalizedLifecycleErrorCode(cleanupError),
            })
          }
          return cleanupCandidates().some((candidate) => candidate && unpublishedCleanups.has(candidate))
            ? cleanup
            : undefined
        },
      }
    },
  }
}
