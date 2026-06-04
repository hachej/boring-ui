"use client"

import { useCallback, useEffect, useState } from "react"
import { onFilesystemChanged } from "../agentFileBridge"

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

    return onFilesystemChanged((event) => {
      if (event.path !== path) return
      reload()
    })
  }, [path, reload])

  return { reloadKey, reload }
}
