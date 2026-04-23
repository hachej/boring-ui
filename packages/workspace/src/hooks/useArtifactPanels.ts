"use client"

import { useCallback, useSyncExternalStore } from "react"
import { useDockviewApi } from "../dock"

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
  surfaceApi: ReturnType<typeof useDockviewApi> | null,
): UseArtifactPanelsReturn {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!surfaceApi) return () => {}
      const interval = setInterval(onStoreChange, 500)
      return () => clearInterval(interval)
    },
    [surfaceApi],
  )

  const getSnapshot = useCallback((): ArtifactPanel[] => {
    if (!surfaceApi) return []
    try {
      const json = surfaceApi.toJSON()
      const panels: ArtifactPanel[] = []
      if (json && typeof json === "object" && "panels" in json) {
        const raw = json as { panels?: Record<string, { id?: string; contentComponent?: string; params?: Record<string, unknown> }> }
        if (raw.panels) {
          for (const [, p] of Object.entries(raw.panels)) {
            if (p.id) {
              panels.push({
                id: p.id,
                component: p.contentComponent ?? p.id,
                params: p.params,
              })
            }
          }
        }
      }
      return panels
    } catch {
      return []
    }
  }, [surfaceApi])

  const panels = useSyncExternalStore(subscribe, getSnapshot, () => [])

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
    (panelId: string) => panels.some((p) => p.id === panelId),
    [panels],
  )

  return { panels, open, close, activate, isOpen }
}
