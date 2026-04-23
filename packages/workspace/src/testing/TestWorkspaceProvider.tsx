"use client"

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react"
import { DataProvider } from "../data/DataProvider"
import type { PanelRegistry } from "../registry/PanelRegistry"
import { WorkspaceProvider } from "../WorkspaceProvider"
import { createMockBridge, type MockWorkspaceBridge } from "./createMockBridge"
import { createMockRegistry } from "./createMockRegistry"
import { createMockApiFetch, type MockDataFixtures } from "./mockApi"

export interface TestWorkspaceProviderProps {
  children: ReactNode
  fixtures?: MockDataFixtures
  bridge?: MockWorkspaceBridge
  registry?: PanelRegistry
  apiBaseUrl?: string
  authHeaders?: Record<string, string>
  defaultTheme?: "light" | "dark"
}

interface TestWorkspaceContextValue {
  bridge: MockWorkspaceBridge
  registry: PanelRegistry
}

const TestWorkspaceContext = createContext<TestWorkspaceContextValue | null>(null)

export function useTestWorkspace(): TestWorkspaceContextValue {
  const context = useContext(TestWorkspaceContext)
  if (!context) {
    throw new Error("useTestWorkspace must be used within a TestWorkspaceProvider")
  }
  return context
}

export function TestWorkspaceProvider({
  children,
  fixtures,
  bridge,
  registry,
  apiBaseUrl = "",
  authHeaders = {},
  defaultTheme = "dark",
}: TestWorkspaceProviderProps) {
  const stableBridge = useMemo(
    () => bridge ?? createMockBridge(),
    [bridge],
  )

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
    <TestWorkspaceContext.Provider value={{ bridge: stableBridge, registry: stableRegistry }}>
      <div data-boring-workspace-testing="" className={defaultTheme === "dark" ? "dark" : undefined}>
        <WorkspaceProvider
          panels={panels}
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          defaultTheme={defaultTheme}
          persistenceEnabled={false}
          bridgeEndpoint={null}
        >
          <DataProvider apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} timeout={1000}>
            {children}
          </DataProvider>
        </WorkspaceProvider>
      </div>
    </TestWorkspaceContext.Provider>
  )
}

export function createDefaultTestBridge(): MockWorkspaceBridge {
  return createMockBridge()
}

export function useTestWorkspaceBridge(): MockWorkspaceBridge {
  return useTestWorkspace().bridge
}

export function useTestWorkspaceRegistry(): PanelRegistry {
  return useTestWorkspace().registry
}
