"use client"

import { useEffect, useRef } from "react"
import { events } from "./index"
import type { WorkspaceEventMap } from "./types"

/**
 * React hook: subscribe to a workspace event for the lifetime of the
 * component. The handler ref is stable across renders so changing the
 * handler doesn't tear down and re-subscribe.
 */
export function useEvent<K extends keyof WorkspaceEventMap>(
  name: K,
  handler: (payload: WorkspaceEventMap[K]) => void,
): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    return events.on(name, (payload) => ref.current(payload))
  }, [name])
}
