"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { DockviewShellApi } from "../dock"

export interface ArtifactPanel {
  id: string
  component: string
  params?: Record<string, unknown>
}

export interface UseArtifactPanelsReturn {
  panels: ArtifactPanel[]
  open: (panel: ArtifactPanel) => void
  close: (panelId: string) => void
  activate: (panelId: string) => void
  isOpen: (panelId: string) => boolean
}

export function useArtifactPanels(
  surfaceApi: DockviewShellApi | null,
): UseArtifactPanelsReturn {
  const [panels, setPanels] = useState<ArtifactPanel[]>([])
  const panelsRef = useRef(panels)
  panelsRef.current = panels

  useEffect(() => {
    if (!surfaceApi) {
      setPanels([])
      return
    }

    function poll() {
      try {
        const json = surfaceApi!.toJSON()
        const next: ArtifactPanel[] = []
        if (json && typeof json === "object" && "panels" in json) {
          const raw = json as {
            panels?: Record<
              string,
              {
                id?: string
                contentComponent?: string
                params?: Record<string, unknown>
              }
            >
          }
          if (raw.panels) {
            for (const [, p] of Object.entries(raw.panels)) {
              if (p.id) {
                next.push({
                  id: p.id,
                  component: p.contentComponent ?? p.id,
                  params: p.params,
                })
              }
            }
          }
        }

        const prev = panelsRef.current
        const changed =
          prev.length !== next.length ||
          prev.some((p, i) => p.id !== next[i]?.id)
        if (changed) setPanels(next)
      } catch {
        // surface not ready yet
      }
    }

    poll()
    const interval = setInterval(poll, 500)
    return () => clearInterval(interval)
  }, [surfaceApi])

  const open = useCallback(
    (panel: ArtifactPanel) => {
      surfaceApi?.addPanel("artifacts", {
        id: panel.id,
        component: panel.component,
        params: panel.params,
      })
    },
    [surfaceApi],
  )

  const close = useCallback(
    (panelId: string) => {
      surfaceApi?.removePanel(panelId)
    },
    [surfaceApi],
  )

  const activate = useCallback(
    (panelId: string) => {
      surfaceApi?.activatePanel(panelId)
    },
    [surfaceApi],
  )

  const isOpen = useCallback(
    (panelId: string) => panelsRef.current.some((p) => p.id === panelId),
    [],
  )

  return { panels, open, close, activate, isOpen }
}
