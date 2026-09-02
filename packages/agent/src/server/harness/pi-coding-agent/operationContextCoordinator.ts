import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { RunContext } from '../../../shared/harness.js'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials/errors.js'

export interface PiHarnessCredentialOperationLease {
  readonly context: RunContext
  /** Aborts when the originating operation ends or its Pi handle is disposed. */
  readonly signal: AbortSignal
  /** Rechecks this exact lease; callers must use it after every async boundary. */
  assertActive(): void
}

interface RevocableOperationLease extends PiHarnessCredentialOperationLease {
  revoke(): void
}

type PiFollowUpQueue = {
  drain: () => unknown[]
}

type PiSessionWithSteeringBoundary = {
  /** Private in Pi 0.84.4; guarded by the exact-version contract canary. */
  _queueSteer?: (text: string, images?: unknown[]) => Promise<void>
}

type PiAgentWithFollowUp = {
  steer?: (message: unknown) => unknown
  followUp?: (message: unknown) => unknown
  /** Private in Pi 0.84.4; guarded by the exact-version contract canary. */
  followUpQueue?: PiFollowUpQueue
}

export interface OperationContextCoordinator {
  run<T>(context: RunContext, operation: () => Promise<T>): Promise<T>
  getActiveLease(): PiHarnessCredentialOperationLease | undefined
  getActiveContext(): RunContext | undefined
  /**
   * Captures queued submitters and installs each fresh lease on only Pi's
   * continuation async chain before prepareNextTurn/automatic compaction.
   */
  bindQueuedFollowUps(session: AgentSession, requireDrainBoundary: boolean): () => void
  /** Revokes this handle's operations, clears queue captures, and rejects future runs. */
  dispose(): void
}

function authorityExpiredError(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
    'credential operation authority is missing or expired',
  )
}

function createLease(context: RunContext): RevocableOperationLease {
  const controller = new AbortController()
  let active = true
  return {
    context,
    signal: controller.signal,
    assertActive() {
      if (!active || controller.signal.aborted) throw authorityExpiredError()
    },
    revoke() {
      if (!active) return
      active = false
      controller.abort()
    },
  }
}

/**
 * Owns operation-scoped authority for one Pi handle/incarnation. The
 * coordinator is allocated before cold creation and disposed with that handle,
 * so stale adapters and late creations cannot retain or mint authority.
 */
export function createOperationContextCoordinator(): OperationContextCoordinator {
  const storage = new AsyncLocalStorage<RevocableOperationLease | undefined>()
  const activeLeases = new Set<RevocableOperationLease>()
  const bindingCleanups = new Set<() => void>()
  let closed = false

  const trackLease = (context: RunContext): RevocableOperationLease => {
    if (closed) throw authorityExpiredError()
    const lease = createLease(context)
    activeLeases.add(lease)
    return lease
  }

  const retireLease = (lease: RevocableOperationLease | undefined): void => {
    if (!lease) return
    activeLeases.delete(lease)
    lease.revoke()
  }

  const activeLease = (): RevocableOperationLease | undefined => {
    if (closed) return undefined
    const lease = storage.getStore()
    try {
      lease?.assertActive()
      return lease
    } catch {
      return undefined
    }
  }

  const run = async <T>(context: RunContext, operation: () => Promise<T>): Promise<T> => {
    const lease = trackLease(context)
    try {
      return await storage.run(lease, operation)
    } finally {
      // Descendants retain object identity. Revocation makes detached work fail
      // closed after the authorized operation ends.
      retireLease(lease)
    }
  }

  const bindQueuedFollowUps = (
    session: AgentSession,
    requireDrainBoundary: boolean,
  ): (() => void) => {
    if (closed) throw authorityExpiredError()
    const nativeSession = session as unknown as PiSessionWithSteeringBoundary
    const agent = (session as unknown as { agent?: PiAgentWithFollowUp }).agent
    const queue = agent?.followUpQueue
    if (
      !agent
      || typeof agent.followUp !== 'function'
      || (requireDrainBoundary && (
        typeof agent.steer !== 'function'
        || typeof nativeSession._queueSteer !== 'function'
      ))
    ) {
      if (requireDrainBoundary) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
          'pinned Pi message-queue boundary is unavailable',
        )
      }
      return () => {}
    }

    let queuedContexts = new WeakMap<object, RunContext>()
    let queuedLease: RevocableOperationLease | undefined
    let unbound = false
    const originalQueueSteer = nativeSession._queueSteer
    const originalSteer = agent.steer
    const originalFollowUp = agent.followUp
    const originalDrain = queue?.drain

    const retireQueuedLease = (): void => {
      retireLease(queuedLease)
      queuedLease = undefined
    }

    const installQueuedContext = (context: RunContext | undefined): void => {
      // The ambient lease is the previous Pi turn on this async chain. Revoke
      // it before switching so detached descendants cannot keep spending it.
      const previousAmbient = storage.getStore()
      retireLease(previousAmbient)
      retireQueuedLease()
      if (closed || unbound || !context) {
        storage.enterWith(undefined)
        return
      }
      queuedLease = trackLease(context)
      // enterWith affects only this continuation chain. Concurrent run(D)
      // calls use storage.run(D) and cannot borrow this queued actor.
      storage.enterWith(queuedLease)
    }

    const steeringDenied = (): CredentialResolutionError => new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
      'steering is unavailable with operation-scoped credentials',
    )
    const wrappedQueueSteer = async function (): Promise<never> {
      throw steeringDenied()
    }
    const wrappedSteer = function (this: PiAgentWithFollowUp, _message: unknown): never {
      throw steeringDenied()
    }

    const wrappedFollowUp = function (this: PiAgentWithFollowUp, message: unknown) {
      const context = activeLease()?.context
      if (context && message && typeof message === 'object') queuedContexts.set(message, context)
      return originalFollowUp.call(this, message)
    }

    const wrappedDrain = function (this: PiFollowUpQueue): unknown[] {
      const messages = originalDrain!.call(this)
      if (messages.length === 0) return messages
      let context: RunContext | undefined
      // Operation-scoped credentials force one-at-a-time mode. Any drift leaves
      // this continuation without authority and therefore fails closed.
      if (messages.length === 1) {
        const message = messages[0]
        if (message && typeof message === 'object') {
          context = queuedContexts.get(message)
          queuedContexts.delete(message)
        }
      }
      installQueuedContext(context)
      return messages
    }

    if (requireDrainBoundary) {
      nativeSession._queueSteer = wrappedQueueSteer
      agent.steer = wrappedSteer
    }
    agent.followUp = wrappedFollowUp
    if (!queue || typeof originalDrain !== 'function') {
      if (requireDrainBoundary) {
        if (nativeSession._queueSteer === wrappedQueueSteer) nativeSession._queueSteer = originalQueueSteer
        if (agent.steer === wrappedSteer) agent.steer = originalSteer
        agent.followUp = originalFollowUp
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
          'pinned Pi follow-up drain seam is unavailable',
        )
      }
    } else {
      queue.drain = wrappedDrain
    }

    const activateAtMessageStart = !queue || typeof originalDrain !== 'function'
    const unsubscribe = session.subscribe((event) => {
      // Pi resumes post-agent retry handling on the async context that awaited
      // the native agent call, not necessarily the context installed when its
      // queue drained. Re-enter the same queued lease before that continuation.
      if (
        ((event.type === 'agent_end' && event.willRetry) || event.type === 'auto_retry_start')
        && queuedLease
      ) {
        queuedLease.assertActive()
        storage.enterWith(queuedLease)
        return
      }
      // agent_settled is the first terminal boundary after all retries,
      // compaction, and queued continuations for this run have finished.
      if (event.type === 'agent_settled') {
        retireQueuedLease()
        storage.enterWith(undefined)
        return
      }
      if (!activateAtMessageStart || event.type !== 'message_start') return
      const message = event.message
      if (!message || typeof message !== 'object') return
      const context = queuedContexts.get(message)
      if (!context) return
      queuedContexts.delete(message)
      installQueuedContext(context)
    })

    const cleanup = (): void => {
      if (unbound) return
      unbound = true
      bindingCleanups.delete(cleanup)
      retireQueuedLease()
      queuedContexts = new WeakMap()
      unsubscribe()
      if (nativeSession._queueSteer === wrappedQueueSteer) nativeSession._queueSteer = originalQueueSteer
      if (agent.steer === wrappedSteer) agent.steer = originalSteer
      if (agent.followUp === wrappedFollowUp) agent.followUp = originalFollowUp
      if (queue && queue.drain === wrappedDrain && originalDrain) queue.drain = originalDrain
    }
    bindingCleanups.add(cleanup)
    return cleanup
  }

  const dispose = (): void => {
    if (closed) return
    closed = true
    // Revoke every active run/continuation before listener removal or Pi
    // disposal. This also aborts durable-store signals before cleanup returns.
    for (const lease of activeLeases) lease.revoke()
    activeLeases.clear()
    storage.disable()
    for (const cleanup of [...bindingCleanups]) cleanup()
    bindingCleanups.clear()
  }

  return {
    run,
    getActiveLease: activeLease,
    getActiveContext: () => activeLease()?.context,
    bindQueuedFollowUps,
    dispose,
  }
}
