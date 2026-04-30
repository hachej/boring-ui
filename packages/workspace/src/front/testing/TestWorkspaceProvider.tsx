"use client"

import {
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react"
import { DataProvider } from "../data/DataProvider"
import type { PanelRegistry } from "../registry/PanelRegistry"
import { WorkspaceProvider } from "../provider"
import { createMockRegistry } from "./createMockRegistry"
import { createMockApiFetch, type MockDataFixtures } from "./mockApi"

export interface TestWorkspaceProviderProps {
  children: ReactNode
  fixtures?: MockDataFixtures
  registry?: PanelRegistry
  apiBaseUrl?: string
  authHeaders?: Record<string, string>
  defaultTheme?: "light" | "dark"
  timeout?: number
}

export function TestWorkspaceProvider({
  children,
  fixtures,
  registry,
  apiBaseUrl = "",
  authHeaders = {},
  defaultTheme = "dark",
  timeout = 1000,
}: TestWorkspaceProviderProps) {
  const stableRegistry = useMemo(
    () => registry ?? createMockRegistry(),
    [registry],
  )

  const panels = useMemo(
    () => stableRegistry.list(),
    [stableRegistry],
  )

  useLayoutEffect(() => {
    if (typeof globalThis.fetch !== "function") return
    const previousFetch = globalThis.fetch.bind(globalThis)
    const mockedFetch = createMockApiFetch(fixtures, previousFetch)
    globalThis.fetch = mockedFetch
    return () => {
      globalThis.fetch = previousFetch
    }
  }, [fixtures])

  return (
    <div data-boring-workspace-testing="" className={defaultTheme === "dark" ? "dark" : undefined}>
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        defaultTheme={defaultTheme}
        persistenceEnabled={false}
        bridgeEndpoint={null}
      >
        <DataProvider apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} timeout={timeout}>
          {children}
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
