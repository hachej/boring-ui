import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import {
  SessionCreationCoordinator,
  type CoordinateSessionCreateOptions,
  type SessionCreationResult,
  type SessionCreationTask,
} from "./sessionCreationCoordinator"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

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

/** React lifecycle adapter for the source-owned creation coordinator. */
export function useSessionCreationCoordinator<TSession extends SessionCreationResult>(
  options: UseSessionCreationCoordinatorOptions<TSession>,
): UseSessionCreationCoordinatorResult<TSession> {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const coordinatorRef = useRef(new SessionCreationCoordinator<TSession>({ ...options, mounted: false }))

  useIsomorphicLayoutEffect(() => {
    coordinatorRef.current.update({ ...optionsRef.current, mounted: true })
    return () => coordinatorRef.current.update({ ...optionsRef.current, mounted: false })
  }, [])

  useIsomorphicLayoutEffect(() => {
    coordinatorRef.current.update({ ...options, mounted: true })
  }, [options])

  const coordinate = useCallback(
    (task: CoordinateSessionCreateOptions<TSession>) => coordinatorRef.current.coordinate(task),
    [],
  )
  const cancel = useCallback(
    (matches: (task: SessionCreationTask<TSession>) => boolean) => coordinatorRef.current.cancel(matches),
    [],
  )

  return useMemo(() => ({ coordinate, cancel }), [cancel, coordinate])
}
