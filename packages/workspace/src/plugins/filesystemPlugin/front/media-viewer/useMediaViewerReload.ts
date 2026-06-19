"use client"

import { useCallback, useEffect, useState } from "react"
import { events } from "../../../../front/events"
import { filesystemEvents } from "../../shared/events"

export interface UseMediaViewerReloadOptions {
  path: string
}

export interface UseMediaViewerReloadReturn {
  reloadKey: number
  reload: () => void
}

export function useMediaViewerReload({ path }: UseMediaViewerReloadOptions): UseMediaViewerReloadReturn {
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!path) return

    const offChanged = events.on(filesystemEvents.changed, (event) => {
      if (event.path === path) reload()
    })
    const offCreated = events.on(filesystemEvents.created, (event) => {
      if (event.kind === "file" && event.path === path) reload()
    })
    const offMoved = events.on(filesystemEvents.moved, (event) => {
      if (event.to === path) reload()
    })
    return () => {
      offChanged()
      offCreated()
      offMoved()
    }
  }, [path, reload])

  return { reloadKey, reload }
}
