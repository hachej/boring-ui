import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import {
  SessionCreationCoordinator,
  type CoordinateSessionCreateOptions,
  type SessionCreationResult,
  type SessionCreationTask,
} from "./sessionCreationCoordinator"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect
const PREFLIGHT_CANCELED = Symbol("session-create-preflight-canceled")

export interface UseSessionCreationCoordinatorOptions<TSession extends SessionCreationResult> {
  sourceKey: string
  validateResult: (value: unknown) => TSession
  ownerIsCurrent: () => boolean
  ownershipReady: boolean
}

export interface UseSessionCreationCoordinatorResult<TSession extends SessionCreationResult> {
  coordinate: (options: CoordinateSessionCreateOptions<TSession>) => Promise<TSession | undefined>
  cancel: (matches: (task: SessionCreationTask<TSession>) => boolean) => void
}

interface CoordinatorRuntime<TSession extends SessionCreationResult>
  extends UseSessionCreationCoordinatorOptions<TSession> {
  mounted: boolean
}

/** Serializes one source's creates and repeats ownership preflight at invocation. */
export function useSessionCreationCoordinator<TSession extends SessionCreationResult>(
  options: UseSessionCreationCoordinatorOptions<TSession>,
): UseSessionCreationCoordinatorResult<TSession> {
  const coordinatorRef = useRef(new SessionCreationCoordinator<TSession>(options.sourceKey))
  const runtimeRef = useRef<CoordinatorRuntime<TSession>>({ ...options, mounted: false })
  const drainRef = useRef<() => void>(() => {})

  const drain = useCallback(() => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    if (
      !runtime.mounted
      || coordinator.sourceKey !== runtime.sourceKey
      || coordinator.active
      || !runtime.ownershipReady
      || !runtime.ownerIsCurrent()
    ) return
    const task = coordinator.takeNext()
    if (!task) return

    void Promise.resolve().then(() => {
      const current = runtimeRef.current
      if (
        !current.mounted
        || coordinatorRef.current !== coordinator
        || current.sourceKey !== task.sourceKey
        || coordinator.active !== task
        || !current.ownershipReady
        || !current.ownerIsCurrent()
      ) {
        coordinator.cancel((candidate) => candidate === task)
        return PREFLIGHT_CANCELED
      }
      return task.create()
    }).then((value) => {
      if (value === PREFLIGHT_CANCELED || coordinator.active !== task) return
      const current = runtimeRef.current
      if (
        !current.mounted
        || coordinatorRef.current !== coordinator
        || current.sourceKey !== task.sourceKey
        || !current.ownershipReady
        || !current.ownerIsCurrent()
      ) {
        coordinator.cancel((candidate) => candidate === task)
        return
      }
      let session: TSession
      try {
        session = current.validateResult(value)
      } catch (error) {
        coordinator.finish(task, { error })
        return
      }
      coordinator.finish(task, { value: session })
    }).catch((error) => {
      if (coordinator.active !== task) return
      const current = runtimeRef.current
      if (
        !current.mounted
        || coordinatorRef.current !== coordinator
        || current.sourceKey !== task.sourceKey
        || !current.ownershipReady
        || !current.ownerIsCurrent()
      ) coordinator.cancel((candidate) => candidate === task)
      else coordinator.finish(task, { error })
    }).finally(() => {
      queueMicrotask(() => drainRef.current())
    })
  }, [])
  drainRef.current = drain

  useIsomorphicLayoutEffect(() => {
    runtimeRef.current.mounted = true
    return () => {
      runtimeRef.current.mounted = false
      coordinatorRef.current.dispose()
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    const runtime = runtimeRef.current
    const coordinator = coordinatorRef.current
    if (coordinator.sourceKey !== options.sourceKey) coordinator.reset(options.sourceKey)
    runtimeRef.current = { ...options, mounted: runtime.mounted }
    if (!options.ownershipReady || !options.ownerIsCurrent()) coordinator.cancel(() => true)
    drainRef.current()
  }, [options])

  const coordinate = useCallback((taskOptions: CoordinateSessionCreateOptions<TSession>) => {
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

  const cancel = useCallback((matches: (task: SessionCreationTask<TSession>) => boolean): void => {
    coordinatorRef.current.cancel(matches)
    queueMicrotask(() => drainRef.current())
  }, [])

  return { coordinate, cancel }
}
