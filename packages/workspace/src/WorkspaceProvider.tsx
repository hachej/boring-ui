"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { PanelRegistry } from "./registry/PanelRegistry"
import { CommandRegistry } from "./registry/CommandRegistry"
import { RegistryProvider } from "./registry/RegistryProvider"
import { createWorkspaceStore } from "./store"
import { bindStore, useThemePreference } from "./store/selectors"
import { createBridge } from "./bridge/createBridge"
import { createBridgeClient, type BridgeClient } from "./bridge/client"
import type { PanelConfig } from "./registry/types"

// ---------------------------------------------------------------------------
// Theme context
// ---------------------------------------------------------------------------

interface ThemeContextValue {
  setTheme: (theme: "light" | "dark") => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): { theme: "light" | "dark"; setTheme: (theme: "light" | "dark") => void } {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within a WorkspaceProvider")
  const theme = useThemePreference()
  return { theme, setTheme: ctx.setTheme }
}

// ---------------------------------------------------------------------------
// Bridge context
// ---------------------------------------------------------------------------

export interface WorkspaceBridgeContextValue {
  connected: boolean
}

const WorkspaceBridgeContext = createContext<WorkspaceBridgeContextValue | null>(null)

export function useWorkspaceBridge(): WorkspaceBridgeContextValue {
  const ctx = useContext(WorkspaceBridgeContext)
  if (!ctx) throw new Error("useWorkspaceBridge must be used within a WorkspaceProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// Data context (stub — implemented in Phase 2)
// ---------------------------------------------------------------------------

export interface DataProviderContextValue {
  apiBaseUrl: string
}

const DataProviderContext = createContext<DataProviderContextValue | null>(null)

export function useDataProvider(): DataProviderContextValue {
  const ctx = useContext(DataProviderContext)
  if (!ctx) throw new Error("useDataProvider must be used within a WorkspaceProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// WorkspaceProvider props
// ---------------------------------------------------------------------------

export interface WorkspaceProviderProps {
  children: ReactNode
  panels?: PanelConfig[]
  capabilities?: Record<string, boolean>
  apiBaseUrl?: string
  authHeaders?: Record<string, string>
  defaultTheme?: "light" | "dark"
  onThemeChange?: (theme: "light" | "dark") => void
  workspaceId?: string
  storageKey?: string
  persistenceEnabled?: boolean
  bridgeEndpoint?: string | null
  onLayoutError?: (error: Error) => void
  onAuthError?: (statusCode: number) => void
}

// ---------------------------------------------------------------------------
// WorkspaceProvider
// ---------------------------------------------------------------------------

export function WorkspaceProvider({
  children,
  panels,
  capabilities,
  apiBaseUrl = "",
  authHeaders,
  defaultTheme = "light",
  onThemeChange,
  workspaceId,
  storageKey,
  persistenceEnabled = true,
  bridgeEndpoint,
  onAuthError,
}: WorkspaceProviderProps) {
  const storeRef = useRef<ReturnType<typeof createWorkspaceStore> | null>(null)
  if (!storeRef.current) {
    const store = createWorkspaceStore({
      workspaceId,
      storageKey,
      persistenceEnabled,
    })
    bindStore(store)

    if (defaultTheme !== "light" && !persistenceEnabled) {
      store.getState().setTheme(defaultTheme)
    } else if (defaultTheme !== "light") {
      const hasPersistedPrefs =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("boring-ui-v2:preferences") !== null
      if (!hasPersistedPrefs) {
        store.getState().setTheme(defaultTheme)
      }
    }

    storeRef.current = store
  }
  const store = storeRef.current
  const bridgeClientRef = useRef<BridgeClient | null>(null)
  const authHeadersRef = useRef(authHeaders)
  authHeadersRef.current = authHeaders
  const onAuthErrorRef = useRef(onAuthError)
  onAuthErrorRef.current = onAuthError

  useEffect(() => {
    return () => {
      bridgeClientRef.current?.disconnect()
      bridgeClientRef.current = null
      store.cleanup()
    }
  }, [store])

  useEffect(() => {
    if (bridgeClientRef.current) {
      bridgeClientRef.current.disconnect()
      bridgeClientRef.current = null
    }

    if (!bridgeEndpoint) return

    const bridge = createBridge(store)
    const authToken = authHeadersRef.current?.["Authorization"]?.replace(/^Bearer\s+/i, "")
    const client = createBridgeClient({
      endpoint: bridgeEndpoint,
      bridge,
      store,
      authToken,
      onAuthError: (code) => onAuthErrorRef.current?.(code),
      onConnectionChange: setBridgeConnected,
    })
    client.connect()
    bridgeClientRef.current = client

    return () => {
      client.disconnect()
      bridgeClientRef.current = null
    }
  }, [bridgeEndpoint, store])

  const { panelRegistry, commandRegistry } = useMemo(() => {
    const pr = new PanelRegistry(capabilities)
    const cr = new CommandRegistry()

    if (panels) {
      for (const panel of panels) {
        const { id, ...config } = panel
        pr.register(id, config)
      }
    }

    return { panelRegistry: pr, commandRegistry: cr }
  }, [capabilities, panels])

  const onThemeChangeRef = useRef(onThemeChange)
  onThemeChangeRef.current = onThemeChange

  const themeSetTheme = useCallback(
    (theme: "light" | "dark") => {
      store.getState().setTheme(theme)
      onThemeChangeRef.current?.(theme)
    },
    [store],
  )

  const themeValue = useMemo<ThemeContextValue>(
    () => ({ setTheme: themeSetTheme }),
    [themeSetTheme],
  )

  const [bridgeConnected, setBridgeConnected] = useState(false)

  const bridgeValue = useMemo<WorkspaceBridgeContextValue>(
    () => ({ connected: bridgeConnected }),
    [bridgeConnected],
  )

  const dataValue = useMemo<DataProviderContextValue>(
    () => ({ apiBaseUrl }),
    [apiBaseUrl],
  )

  return (
    <ThemeContext.Provider value={themeValue}>
      <WorkspaceBridgeContext.Provider value={bridgeValue}>
        <DataProviderContext.Provider value={dataValue}>
          <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
            {children}
          </RegistryProvider>
        </DataProviderContext.Provider>
      </WorkspaceBridgeContext.Provider>
    </ThemeContext.Provider>
  )
}
