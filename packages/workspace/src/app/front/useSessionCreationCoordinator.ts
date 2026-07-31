import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import {
  SessionCreationCoordinator,
  type CoordinateSessionCreateOptions,
  type SessionCreationRow,
  type SessionCreationTask,
} from "./sessionCreationCoordinator"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect
const PREFLIGHT_CANCELED = Symbol("session-create-preflight-canceled")

export interface UseSessionCreationCoordinatorOptions<TRow extends SessionCreationRow> {
  sourceKey: string
  rows: readonly TRow[]
  activeKey: string | null
  keyFor: (row: TRow) => string
  hasCanonicalResult: (value: unknown) => boolean
  ownerIsCurrent: () => boolean
  ownershipReady: boolean
  refresh?: () => void | Promise<unknown>
  reconciliationTimeoutMs?: number
}

export interface UseSessionCreationCoordinatorResult<TRow extends SessionCreationRow> {
  coordinate: (options: CoordinateSessionCreateOptions<TRow>) => Promise<unknown>
  cancel: (matches: (task: SessionCreationTask<TRow>) => boolean) => void
}

interface CoordinatorRuntime<TRow extends SessionCreationRow> extends UseSessionCreationCoordinatorOptions<TRow> {
  mounted: boolean
}

/**
 * Owns the complete create lifecycle so WorkspaceAgentFront only describes
 * create intent. Provider invocation is deferred and repeats the ownership
 * preflight at the exact call boundary.
 */
export function useSessionCreationCoordinator<TRow extends SessionCreationRow>(
  options: UseSessionCreationCoordinatorOptions<TRow>,
): UseSessionCreationCoordinatorResult<TRow> {
  const coordinatorRef = useRef(new SessionCreationCoordinator<TRow>(options.sourceKey))
  const coordinatorsRef = useRef(new Map<string, SessionCreationCoordinator<TRow>>([
    [options.sourceKey, coordinatorRef.current],
  ]))
  const runtimeRef = useRef<CoordinatorRuntime<TRow>>({ ...options, mounted: false })
  const drainRef = useRef<() => void>(() => {})
  const reconcileRef = useRef<() => boolean>(() => false)
  const armRowWaitRef = useRef<(task: SessionCreationTask<TRow>) => void>(() => {})

  const keysFor = useCallback((runtime: CoordinatorRuntime<TRow>) => (
    runtime.rows.map(runtime.keyFor)
  ), [])

  const cleanupParkedCoordinators = useCallback(() => {
    // Keep no idle cache: the registry is bounded to the current source plus
    // parked sources whose live task, orphan, or timer cannot be discarded.
    const current = coordinatorRef.current
    for (const [sourceKey, coordinator] of coordinatorsRef.current) {
      if (coordinator === current || !coordinator.canEvict) continue
      coordinator.dispose()
      coordinatorsRef.current.delete(sourceKey)
    }
  }, [])

  const finishError = useCallback((task: SessionCreationTask<TRow>, error: unknown) => {
    const coordinator = coordinatorRef.current
    if (coordinator.active !== task) return
    let rejection = error
    try {
      task.onError?.(error)
    } catch (callbackError) {
      rejection = callbackError
    }
    if (coordinator.finish(task, { error: rejection })) queueMicrotask(() => drainRef.current())
  }, [])

  const finishResolved = useCallback((task: SessionCreationTask<TRow>, value: unknown) => {
    const coordinator = coordinatorRef.current
    if (coordinator.active !== task) return
    try {
      task.onResolved?.(value)
    } catch (error) {
      finishError(task, error)
      return
    }
    if (coordinator.finish(task, { value })) queueMicrotask(() => drainRef.current())
  }, [finishError])

  const orphanBarrierFor = useCallback((
    runtime: CoordinatorRuntime<TRow>,
    coordinator: SessionCreationCoordinator<TRow>,
  ) => ({
    timeoutMs: runtime.reconciliationTimeoutMs ?? 10_000,
    onRelease: () => {
      queueMicrotask(() => {
        cleanupParkedCoordinators()
        if (coordinatorRef.current !== coordinator) return
        if (!reconcileRef.current()) {
          const active = coordinator.active
          if (active) armRowWaitRef.current(active)
        }
        drainRef.current()
      })
    },
  }), [cleanupParkedCoordinators])

  const armRowWait = useCallback((task: SessionCreationTask<TRow>): void => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    if (
      coordinator.active !== task
      || task.phase !== "awaiting-row"
      || task.rowWaitTimeout !== undefined
      || coordinator.hasOrphanAttributionBarrier
    ) return
    const timeoutMs = runtime.reconciliationTimeoutMs ?? 10_000
    task.rowWaitTimeout = globalThis.setTimeout(() => {
      if (coordinator.active !== task) return
      coordinator.abandon(task, keysFor(runtimeRef.current), orphanBarrierFor(runtimeRef.current, coordinator))
      const error = Object.assign(
        new Error("Session create did not publish one canonical row before reconciliation expired"),
        { code: "SESSION_CREATE_RECONCILIATION_TIMEOUT" as const },
      )
      finishError(task, error)
    }, timeoutMs)
  }, [finishError, keysFor, orphanBarrierFor])
  armRowWaitRef.current = armRowWait

  const reconcile = useCallback((): boolean => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    const task = coordinator.active
    coordinator.observeRows(keysFor(runtime))
    if (
      !task
      || coordinator.sourceKey !== runtime.sourceKey
      || !runtime.mounted
      || !runtime.ownershipReady
      || !runtime.ownerIsCurrent()
    ) return false
    const candidate = coordinator.selectCandidate({
      task,
      rows: runtime.rows,
      activeKey: runtime.activeKey,
      keyFor: runtime.keyFor,
    })
    if (!candidate) return false
    finishResolved(task, candidate)
    return true
  }, [finishResolved, keysFor])
  reconcileRef.current = reconcile

  const drain = useCallback(() => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    if (!runtime.mounted || coordinator.sourceKey !== runtime.sourceKey || coordinator.active) return
    const observedKeys = keysFor(runtime)
    if (!runtime.ownershipReady || !runtime.ownerIsCurrent()) {
      coordinator.cancel(() => true, observedKeys, orphanBarrierFor(runtime, coordinator))
      return
    }
    const task = coordinator.takeNext(observedKeys)
    if (!task) return

    void Promise.resolve().then(() => {
      const current = runtimeRef.current
      const isCurrentSource = coordinatorRef.current === coordinator && current.sourceKey === coordinator.sourceKey
      const currentKeys = isCurrentSource ? keysFor(current) : []
      if (
        !current.mounted
        || !isCurrentSource
        || coordinator.sourceKey !== task.sourceKey
        || coordinator.active !== task
        || !current.ownershipReady
        || !current.ownerIsCurrent()
      ) {
        coordinator.cancel(
          (candidate) => candidate === task,
          currentKeys,
          orphanBarrierFor(runtime, coordinator),
        )
        return PREFLIGHT_CANCELED
      }
      if (!coordinator.beginInvocation(task, currentKeys)) return PREFLIGHT_CANCELED
      return task.create()
    }).then((value) => {
      if (value === PREFLIGHT_CANCELED) {
        queueMicrotask(() => drainRef.current())
        return
      }
      const current = runtimeRef.current
      const isCurrentSource = coordinatorRef.current === coordinator && current.sourceKey === coordinator.sourceKey
      const currentKeys = isCurrentSource ? keysFor(current) : []
      coordinator.settleInvocation(task, currentKeys)
      if (
        !current.mounted
        || !isCurrentSource
        || !current.ownershipReady
        || !current.ownerIsCurrent()
      ) {
        coordinator.cancel(
          (candidate) => candidate === task,
          currentKeys,
          orphanBarrierFor(runtime, coordinator),
        )
        queueMicrotask(() => drainRef.current())
        return
      }
      if (coordinator.active !== task) {
        reconcileRef.current()
        queueMicrotask(() => drainRef.current())
        return
      }
      if (current.hasCanonicalResult(value)) {
        finishResolved(task, value)
        return
      }
      if (!coordinator.markAwaitingRow(task)) return
      if (reconcileRef.current()) return
      armRowWaitRef.current(task)
      try {
        void Promise.resolve(current.refresh?.())
          .then(() => reconcileRef.current())
          .catch(() => {
            // The bounded row wait remains the final failure path.
          })
      } catch {
        // The bounded row wait remains the final failure path.
      }
    }).catch((error) => {
      const current = runtimeRef.current
      const isCurrentSource = coordinatorRef.current === coordinator && current.sourceKey === coordinator.sourceKey
      const currentKeys = isCurrentSource ? keysFor(current) : []
      coordinator.settleInvocation(task, currentKeys)
      if (
        !current.mounted
        || !isCurrentSource
        || !current.ownershipReady
        || !current.ownerIsCurrent()
      ) {
        coordinator.cancel(
          (candidate) => candidate === task,
          currentKeys,
          orphanBarrierFor(runtime, coordinator),
        )
        queueMicrotask(() => drainRef.current())
        return
      }
      if (coordinator.active !== task) {
        reconcileRef.current()
        queueMicrotask(() => drainRef.current())
        return
      }
      finishError(task, error)
    })
  }, [finishError, finishResolved, keysFor, orphanBarrierFor])
  drainRef.current = drain

  useIsomorphicLayoutEffect(() => {
    runtimeRef.current.mounted = true
    return () => {
      runtimeRef.current.mounted = false
      for (const coordinator of coordinatorsRef.current.values()) coordinator.dispose()
      coordinatorsRef.current.clear()
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    const previous = runtimeRef.current
    let coordinator = coordinatorRef.current
    if (coordinator.sourceKey !== options.sourceKey) {
      coordinator.cancel(
        () => true,
        keysFor(previous),
        orphanBarrierFor(previous, coordinator),
      )
      coordinator = coordinatorsRef.current.get(options.sourceKey)
        ?? new SessionCreationCoordinator<TRow>(options.sourceKey)
      coordinatorsRef.current.set(options.sourceKey, coordinator)
      coordinatorRef.current = coordinator
      cleanupParkedCoordinators()
    }
    runtimeRef.current = { ...options, mounted: previous.mounted }
    if (!options.ownershipReady || !options.ownerIsCurrent()) {
      const runtime = runtimeRef.current
      coordinator.cancel(
        () => true,
        options.rows.map(options.keyFor),
        orphanBarrierFor(runtime, coordinator),
      )
      return
    }
    reconcileRef.current()
    drainRef.current()
  }, [cleanupParkedCoordinators, keysFor, options, orphanBarrierFor])

  const coordinate = useCallback((taskOptions: CoordinateSessionCreateOptions<TRow>): Promise<unknown> => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    if (
      !runtime.mounted
      || coordinator.sourceKey !== runtime.sourceKey
      || !runtime.ownershipReady
      || !runtime.ownerIsCurrent()
    ) return Promise.resolve(undefined)
    const promise = coordinator.coordinate(taskOptions)
    drainRef.current()
    return promise
  }, [])

  const cancel = useCallback((matches: (task: SessionCreationTask<TRow>) => boolean): void => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    coordinator.cancel(matches, keysFor(runtime), orphanBarrierFor(runtime, coordinator))
    queueMicrotask(() => drainRef.current())
  }, [keysFor, orphanBarrierFor])

  return { coordinate, cancel }
}
