import { ErrorCode } from '../../shared/error-codes'
import type { PiAgentSessionAdapter } from './PiAgentSessionAdapter'

export class HarnessPiChatServiceLifecycle {
  private readonly admitted = new Set<Promise<unknown>>()
  private readonly cleanupErrors: unknown[] = []
  private readonly closingSignal = deferred()
  private closing = false

  get isClosing(): boolean {
    return this.closing
  }

  get closingPromise(): Promise<void> {
    return this.closingSignal.promise
  }

  beginClosing(): void {
    this.closing = true
    this.closingSignal.resolve()
  }

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(bindingDisposedError())
    const tracked = Promise.resolve().then(operation)
    this.admitted.add(tracked)
    tracked.then(
      () => this.admitted.delete(tracked),
      () => this.admitted.delete(tracked),
    )
    return tracked
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.admitted])
  }

  assertOpen(): void {
    if (this.closing) throw bindingDisposedError()
  }

  async assertAdapterOwned(adapter: PiAgentSessionAdapter): Promise<void> {
    if (!this.closing) return
    await this.cleanupLateAdapter(adapter)
    throw bindingDisposedError()
  }

  async rejectLateAdapter(adapter: PiAgentSessionAdapter, primaryError: unknown): Promise<never> {
    await this.cleanupLateAdapter(adapter)
    throw primaryError
  }

  takeCleanupErrors(): unknown[] {
    return this.cleanupErrors.splice(0)
  }

  private async cleanupLateAdapter(adapter: PiAgentSessionAdapter): Promise<void> {
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => adapter.abortRetry?.()),
      Promise.resolve().then(() => adapter.clearFollowUp()),
      Promise.resolve().then(() => adapter.abort()),
    ])
    this.cleanupErrors.push(...cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []))
  }
}

function bindingDisposedError(): Error & { code: string } {
  return Object.assign(new Error('Pi chat service has been disposed.'), {
    code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
  })
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => { resolve = () => nextResolve() })
  return { promise, resolve }
}
