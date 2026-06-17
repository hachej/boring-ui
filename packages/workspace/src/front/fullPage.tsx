"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

export type PanelRenderMode = "dock" | "full-page"

const FullPageBasePathContext = createContext<string | null>(null)
const PanelRenderModeContext = createContext<PanelRenderMode>("dock")

export interface FullPageBasePathProviderProps {
  basePath?: string
  children: ReactNode
}

export function FullPageBasePathProvider({ basePath, children }: FullPageBasePathProviderProps) {
  return <FullPageBasePathContext.Provider value={basePath ?? null}>{children}</FullPageBasePathContext.Provider>
}

export interface PanelRenderModeProviderProps {
  mode: PanelRenderMode
  children: ReactNode
}

export function PanelRenderModeProvider({ mode, children }: PanelRenderModeProviderProps) {
  return <PanelRenderModeContext.Provider value={mode}>{children}</PanelRenderModeContext.Provider>
}

export interface BuildFullPagePanelHrefInput {
  componentId: string
  params?: Record<string, unknown>
  basePath: string
}

export function buildFullPagePanelHref({ componentId, params, basePath }: BuildFullPagePanelHrefInput): string {
  const [pathWithSearch, hash = ""] = basePath.split("#", 2)
  const [path, rawSearch = ""] = pathWithSearch.split("?", 2)
  const search = new URLSearchParams(rawSearch)
  search.set("component", componentId)
  if (params && Object.keys(params).length > 0) {
    search.set("params", JSON.stringify(params))
  } else {
    search.delete("params")
  }
  const suffix = hash ? `#${hash}` : ""
  return `${path}?${search.toString()}${suffix}`
}

export function useFullPagePanelHref(input: {
  componentId: string
  params?: Record<string, unknown>
}): string | null {
  const basePath = useContext(FullPageBasePathContext)
  return useMemo(() => {
    if (!basePath) return null
    return buildFullPagePanelHref({
      componentId: input.componentId,
      params: input.params,
      basePath,
    })
  }, [basePath, input.componentId, input.params])
}

export function usePanelRenderMode(): PanelRenderMode {
  return useContext(PanelRenderModeContext)
}

export function useIsFullPagePanel(): boolean {
  return usePanelRenderMode() === "full-page"
}
