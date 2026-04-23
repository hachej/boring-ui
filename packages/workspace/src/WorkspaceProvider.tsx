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
import { CommandPalette } from "./components/CommandPalette"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import type { PanelConfig } from "./registry/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

// ---------------------------------------------------------------------------
// Theme context
// ---------------------------------------------------------------------------

interface ThemeContextValue {
  setTheme: (theme: "light" | "dark") => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): {
  theme: "light" | "dark"
  setTheme: (theme: "light" | "dark") => void
  toggleTheme: () => void
} {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within a WorkspaceProvider")
  const theme = useThemePreference()
  return { theme, setTheme: ctx.setTheme, toggleTheme: ctx.toggleTheme }
}

export interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: "light" | "dark"
  onThemeChange?: (theme: "light" | "dark") => void
}

export function ThemeProvider({ children, defaultTheme, onThemeChange }: ThemeProviderProps) {
  const storeRef = useRef<ReturnType<typeof createWorkspaceStore> | null>(null)
  if (!storeRef.current) {
    const s = createWorkspaceStore({ persistenceEnabled: false })
    bindStore(s)
    const initial = defaultTheme ?? getSystemTheme()
    if (initial !== "light") s.getState().setTheme(initial)
    storeRef.current = s
  }
  const store = storeRef.current

  const setTheme = useCallback(
    (theme: "light" | "dark") => {
      store.getState().setTheme(theme)
      onThemeChange?.(theme)
    },
    [store, onThemeChange],
  )

  const toggleTheme = useCallback(() => {
    const next = store.getState().preferences.theme === "light" ? "dark" : "light"
    setTheme(next)
  }, [store, setTheme])

  const theme = useThemePreference()

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    return () => {
      document.documentElement.removeAttribute("data-theme")
    }
  }, [theme])

  const value = useMemo<ThemeContextValue>(() => ({ setTheme, toggleTheme }), [setTheme, toggleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
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
// Built-in workspace shortcuts (rendered inside the provider tree)
// ---------------------------------------------------------------------------

function WorkspaceShortcuts({
  store,
}: {
  store: ReturnType<typeof createWorkspaceStore>
}) {
  const shortcuts = useMemo(
    () => [
      {
        key: "b",
        mod: true,
        handler: () => {
          const s = store.getState()
          s.setSidebar({ collapsed: !s.sidebar.collapsed })
        },
      },
      {
        key: "\\",
        mod: true,
        handler: () => {
          const s = store.getState()
          const agentPanel = s.panels.find((p) => p.id === "agent")
          if (agentPanel) {
            s.closePanel("agent")
          } else {
            s.openPanel({ id: "agent", component: "agent" })
          }
        },
      },
      {
        key: "w",
        mod: true,
        handler: () => {
          const s = store.getState()
          if (s.activePanel) s.closePanel(s.activePanel)
        },
      },
    ],
    [store],
  )

  useKeyboardShortcuts({ shortcuts })
  return null
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
  defaultTheme?: "light" | "dark" | undefined
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
  defaultTheme,
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

    const resolvedDefault = defaultTheme ?? getSystemTheme()
    if (resolvedDefault !== "light" && !persistenceEnabled) {
      store.getState().setTheme(resolvedDefault)
    } else if (resolvedDefault !== "light") {
      const hasPersistedPrefs =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("boring-ui-v2:preferences") !== null
      if (!hasPersistedPrefs) {
        store.getState().setTheme(resolvedDefault)
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

    cr.registerCommand({
      id: "workspace.toggleSidebar",
      title: "Toggle Sidebar",
      shortcut: "⌘B",
      run: () => {
        const s = store.getState()
        s.setSidebar({ collapsed: !s.sidebar.collapsed })
      },
    })
    cr.registerCommand({
      id: "workspace.toggleAgentPanel",
      title: "Toggle Agent Panel",
      shortcut: "⌘\\",
      run: () => {
        const s = store.getState()
        const agentPanel = s.panels.find((p) => p.id === "agent")
        if (agentPanel) {
          s.closePanel("agent")
        } else {
          s.openPanel({ id: "agent", component: "agent" })
        }
      },
    })
    cr.registerCommand({
      id: "workspace.closeTab",
      title: "Close Tab",
      shortcut: "⌘W",
      run: () => {
        const s = store.getState()
        if (s.activePanel) s.closePanel(s.activePanel)
      },
    })

    return { panelRegistry: pr, commandRegistry: cr }
  }, [capabilities, panels, store])

  const onThemeChangeRef = useRef(onThemeChange)
  onThemeChangeRef.current = onThemeChange

  const themeSetTheme = useCallback(
    (theme: "light" | "dark") => {
      store.getState().setTheme(theme)
      onThemeChangeRef.current?.(theme)
    },
    [store],
  )

  const themeToggleTheme = useCallback(() => {
    const next = store.getState().preferences.theme === "light" ? "dark" : "light"
    themeSetTheme(next)
  }, [store, themeSetTheme])

  const currentTheme = useThemePreference()

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", currentTheme)
    return () => {
      document.documentElement.removeAttribute("data-theme")
    }
  }, [currentTheme])

  const themeValue = useMemo<ThemeContextValue>(
    () => ({ setTheme: themeSetTheme, toggleTheme: themeToggleTheme }),
    [themeSetTheme, themeToggleTheme],
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
            <WorkspaceShortcuts store={store} />
            <CommandPalette />
            {children}
          </RegistryProvider>
        </DataProviderContext.Provider>
      </WorkspaceBridgeContext.Provider>
    </ThemeContext.Provider>
  )
}
