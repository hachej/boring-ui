import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import { ErrorCode } from '../../shared/error-codes'
import {
  assertWorkspaceAgentDispatcherRequestContext,
  createBoundWorkspaceAgentDispatcher,
} from '../workspaceAgentDispatcher'
import type { AgentHostRuntime } from './createAgentHost'
import type { EmbeddedAgentGateway } from './embeddedGateway'
import type { AgentHostDispatcherRunInput, LeaseBoundWorkspaceAgent } from './types'

export function bindingDisposedError(): Error & { readonly code: string } {
  return Object.assign(new Error('Agent Host lease has been released'), {
    code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
  })
}

export function guardMethods<T extends object>(
  value: T,
  assertActive: () => void,
  track?: <R>(operation: Promise<R>) => Promise<R>,
  registerCleanup?: (cleanup: () => void) => () => void,
): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver) as unknown
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        assertActive()
        if (property === 'watch' && registerCleanup) {
          const watcher = Reflect.apply(member, target, args) as import('../../shared/workspace').WorkspaceWatcher
          return Object.freeze({
            subscribe(
              listener: (event: import('../../shared/workspace').WorkspaceChangeEvent) => void,
              options?: import('../../shared/workspace').WorkspaceWatchSubscribeOptions,
            ) {
              assertActive()
              let subscribed = true
              const unsubscribe = watcher.subscribe((event) => {
                if (!subscribed) return
                try { assertActive() } catch { return }
                listener(event)
              }, options?.onControlEvent
                ? {
                    onControlEvent(event) {
                      if (!subscribed) return
                      try { assertActive() } catch { return }
                      options.onControlEvent!(event)
                    },
                  }
                : undefined)
              const unregisterCleanup = registerCleanup(() => {
                if (!subscribed) return
                subscribed = false
                unsubscribe()
              })
              return () => {
                if (!subscribed) return
                subscribed = false
                unregisterCleanup()
                unsubscribe()
              }
            },
            whenReady: watcher.whenReady
              ? () => {
                  assertActive()
                  const ready = watcher.whenReady!()
                  return track ? track(ready) : ready
                }
              : undefined,
            close() {
              throw new TypeError('callback leases cannot close the provider-owned workspace watcher')
            },
          })
        }
        const result = Reflect.apply(member, target, args)
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          return track ? track(Promise.resolve(result)) : result
        }
        if (property !== 'watch' || !result || typeof result !== 'object') return result
        return guardMethods(result as object, assertActive, track, registerCleanup)
      }
    },
  })
}

/** Runs one callback-scoped dispatcher lease and fences every operation before provider release. */
export async function runWithWorkspaceAgentLease(input: {
  readonly runtime: AgentHostRuntime
  readonly gateway: EmbeddedAgentGateway
  readonly request: AgentHostDispatcherRunInput
  readonly run: (binding: LeaseBoundWorkspaceAgent) => Promise<void>
}): Promise<void> {
  const { runtime, gateway, request, run } = input
  const requestId = request.requestId.trim()
  if (!requestId || requestId.length > 128) throw new TypeError('requestId must be 1-128 characters')
  assertWorkspaceAgentDispatcherRequestContext(request.context, request.request)
  const claim = await runtime.verify(request.authorizedScope)
  if (claim.authSubjectId !== request.context.userId.trim()) {
    throw new AgentGatewayError(
      AgentGatewayErrorCode.AGENT_SCOPE_DENIED,
      'dispatcher actor does not match the verified capability',
    )
  }
  const resolved = await runtime.resolveAgentRuntimeScope(
    request.agentTypeId,
    request.authorizedScope,
    claim,
    'new-binding',
    requestId,
  )
  const runtimeBinding = await runtime.resolveBinding(
    request.agentTypeId,
    request.authorizedScope,
    claim,
    resolved,
  )
  const operationEnvironment = await runtime.acquireResolvedEnvironment(
    claim.workspaceScopeId,
    runtimeBinding.scope.environment,
  )
  const abort = new AbortController()
  let accepting = true
  let revoked = false
  let unregister = () => {}
  const operations = new Set<Promise<unknown>>()
  const cleanups = new Set<() => void>()
  let signalDrain!: () => void
  const drainRequested = new Promise<void>((resolve) => { signalDrain = resolve })
  let signalRevocation!: () => void
  const revocation = new Promise<void>((resolve) => { signalRevocation = resolve })
  let drainDeadline: number | undefined
  const registerCleanup = (cleanup: () => void) => {
    cleanups.add(cleanup)
    return () => cleanups.delete(cleanup)
  }
  const trackOperation = <T>(operation: Promise<T>): Promise<T> => {
    const publication = Promise.race([
      operation.then((value) => {
        if (revoked) throw bindingDisposedError()
        return value
      }),
      revocation.then(() => { throw bindingDisposedError() }),
    ])
    const tracked = publication.finally(() => operations.delete(tracked))
    operations.add(tracked)
    tracked.catch(() => {})
    return tracked
  }
  let finishPromise: Promise<PromiseSettledResult<unknown>[]> | undefined
  const finish = (abortStarted: boolean) => {
    accepting = false
    if (abortStarted && drainDeadline === undefined) {
      drainDeadline = Date.now() + runtime.shutdownGraceMs
      abort.abort()
      signalDrain()
    }
    finishPromise ??= (async () => {
      const settled: PromiseSettledResult<unknown>[] = []
      for (const cleanup of [...cleanups]) {
        try {
          cleanup()
        } catch (reason) {
          settled.push({ status: 'rejected', reason })
        }
      }
      cleanups.clear()
      while (operations.size > 0) {
        const pending = [...operations]
        if (drainDeadline === undefined) {
          const outcome = await Promise.race([
            Promise.allSettled(pending).then((results) => ({ kind: 'settled' as const, results })),
            drainRequested.then(() => ({ kind: 'drain' as const })),
          ])
          if (outcome.kind === 'drain') continue
          settled.push(...outcome.results)
          continue
        }
        const remainingMs = Math.max(0, drainDeadline - Date.now())
        const outcome = await Promise.race([
          Promise.allSettled(pending).then((results) => ({ kind: 'settled' as const, results })),
          new Promise<{ kind: 'expired' }>((resolve) => {
            setTimeout(() => resolve({ kind: 'expired' }), remainingMs)
          }),
        ])
        if (outcome.kind === 'expired') break
        settled.push(...outcome.results)
      }
      // Teardown must always cross the revocation boundary even when a
      // provider-supplied watcher cleanup is defective. Nothing may publish
      // after this point, and every close/release remains exactly-once.
      revoked = true
      signalRevocation()
      abort.abort()
      try {
        unregister()
      } catch (reason) {
        settled.push({ status: 'rejected', reason })
      }
      try {
        operationEnvironment.release()
      } catch (reason) {
        settled.push({ status: 'rejected', reason })
      }
      return settled
    })()
    return finishPromise
  }
  try {
    unregister = runtime.registerSubscription(async () => {
      const settled = await finish(true)
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
    })
  } catch (error) {
    await finish(true)
    throw error
  }
  const assertActive = () => {
    if (!accepting || revoked) throw bindingDisposedError()
  }
  const dispatcher = createBoundWorkspaceAgentDispatcher({
    gateway,
    scope: request.authorizedScope,
    agentTypeId: request.agentTypeId,
  }, request.context)
  const refFor = (sessionId: string) => ({ agentTypeId: request.agentTypeId, sessionId })
  const leaseBinding: LeaseBoundWorkspaceAgent = Object.freeze({
    workspace: guardMethods(operationEnvironment.bundle.workspace, assertActive, trackOperation, registerCleanup),
    signal: abort.signal,
    async dispatch(
      dispatchInput: Parameters<LeaseBoundWorkspaceAgent['dispatch']>[0],
      onEvent: Parameters<LeaseBoundWorkspaceAgent['dispatch']>[1],
      onAccepted: Parameters<LeaseBoundWorkspaceAgent['dispatch']>[2],
    ) {
      assertActive()
      return await trackOperation((async () => {
        const dispatched = await dispatcher.dispatch!(dispatchInput)
        await onAccepted?.({ ref: dispatched.ref, receipt: dispatched.receipt })
        for await (const event of dispatched.events) {
          if (revoked) throw bindingDisposedError()
          await onEvent(event)
        }
        if (revoked) throw bindingDisposedError()
        return { ref: dispatched.ref, receipt: dispatched.receipt }
      })())
    },
    async listSessions(limit?: number) {
      assertActive()
      return await trackOperation(gateway.listSessions({
        scope: request.authorizedScope,
        agentTypeId: request.agentTypeId,
        ...(limit === undefined ? {} : { limit }),
      }))
    },
    async sendIfIdle(sessionId: string, message: string, controlRequestId: string) {
      assertActive()
      return await trackOperation((async () => {
        const connection = await gateway.connectSession({ scope: request.authorizedScope, ref: refFor(sessionId) })
        try {
          return await connection.send({
            kind: 'prompt',
            requestId: controlRequestId,
            clientNonce: controlRequestId,
            content: message,
            requireIdle: true,
          })
        } finally {
          await connection.close()
        }
      })())
    },
    async interrupt(sessionId: string, controlRequestId: string) {
      assertActive()
      return await trackOperation((async () => {
        const connection = await gateway.connectSession({ scope: request.authorizedScope, ref: refFor(sessionId) })
        try {
          return await connection.interrupt({ requestId: controlRequestId })
        } finally {
          await connection.close()
        }
      })())
    },
    async stop(sessionId: string, controlRequestId: string) {
      assertActive()
      return await trackOperation((async () => {
        const connection = await gateway.connectSession({ scope: request.authorizedScope, ref: refFor(sessionId) })
        try {
          return await connection.stop({ requestId: controlRequestId })
        } finally {
          await connection.close()
        }
      })())
    },
  })
  let callbackError: unknown
  try {
    const callback = Promise.resolve(run(leaseBinding))
    callback.catch(() => {})
    const result = await Promise.race([
      callback,
      revocation.then(() => { throw bindingDisposedError() }),
    ])
    if (result !== undefined) throw new TypeError('runWithWorkspaceAgent callback must return void')
  } catch (error) {
    callbackError = error
  }
  const settled = await finish(false)
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
  if (callbackError !== undefined) throw callbackError
}
