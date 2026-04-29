"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import type { ChatPanelProps } from "@boring/agent"
import { PanelRegistry } from "./registry/PanelRegistry"
import { CommandRegistry } from "./registry/CommandRegistry"
import { RegistryProvider, useCatalogRegistry } from "./registry/RegistryProvider"
import { CatalogRegistry } from "./plugin/CatalogRegistry"
import { PluginErrorProvider } from "./plugin/PluginErrorContext"
import { createWorkspaceStore } from "../store"
import { bindStore, useThemePreference } from "../store/selectors"
import { createBridge } from "./bridge/createBridge"
import { createBridgeClient, type BridgeClient } from "./bridge/client"
import { CommandPalette } from "./components/CommandPalette"
import { DataProvider, useDataClient, type FetchClient } from "../data"
import { Toaster } from "../toast"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import { bootstrap } from "../shared/plugin/bootstrap"
import { filesystemPlugin } from "../plugins/filesystemPlugin"
import { coreWorkspacePanels } from "./registry/coreRegistrations"
import type { Plugin } from "../shared/plugin/types"
import type { PanelConfig } from "./registry/types"
import type { CatalogConfig } from "../shared/plugin/types"
import type { ExplorerRow, SearchResult } from "./components/DataExplorer/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function NullChatPanel(_props: ChatPanelProps) {
  return null
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function rowFromPath(path: string): ExplorerRow {
  const lastSlash = path.lastIndexOf("/")
  return {
    id: path,
    title: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
    subtitle: lastSlash >= 0 ? path.slice(0, lastSlash + 1) : undefined,
  }
}

function emptySearchResult(): SearchResult {
  return { items: [], total: 0, hasMore: false }
}

const PROVIDER_CATALOG_SOURCE = "workspace-provider"

function createFilesCatalog(
  client: Pick<FetchClient, "search">,
  onOpenFile: (path: string) => void,
): CatalogConfig {
  return {
    id: "files",
    label: "Files",
    adapter: {
      async search({ query, limit, signal }) {
        const trimmed = query.trim()
        if (!trimmed || signal?.aborted) return emptySearchResult()
        const paths = await client.search(trimmed, limit, signal)
        if (signal?.aborted) return emptySearchResult()
        return {
          items: paths.map(rowFromPath),
          total: paths.length,
          hasMore: false,
        }
      },
    },
    onSelect: (row) => onOpenFile(row.id),
  }
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
// Workspace context
// ---------------------------------------------------------------------------

export interface WorkspaceContextValue {
  chatPanel: ComponentType<ChatPanelProps> | null
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspaceContext must be used within a WorkspaceProvider")
  return ctx
}

export function useWorkspaceChatPanel(): ComponentType<ChatPanelProps> {
  const { chatPanel } = useWorkspaceContext()
  if (!chatPanel) {
    throw new Error("WorkspaceProvider requires a chatPanel prop before rendering ChatPanelHost")
  }
  return chatPanel
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

function WorkspaceCatalogBindings({
  catalogs,
  onOpenFile,
}: {
  catalogs?: CatalogConfig[]
  onOpenFile?: (path: string) => void
}) {
  const dataClient = useDataClient()
  const catalogRegistry = useCatalogRegistry()

  useEffect(() => {
    const providerCatalogs: CatalogConfig[] = []

    if (onOpenFile) {
      providerCatalogs.push(createFilesCatalog(dataClient, onOpenFile))
    }

    if (catalogs?.length) {
      providerCatalogs.push(...catalogs)
    }

    for (const catalog of providerCatalogs) {
      catalogRegistry.register(catalog, PROVIDER_CATALOG_SOURCE)
    }

    return () => {
      catalogRegistry.unregisterByPluginId(PROVIDER_CATALOG_SOURCE)
    }
  }, [catalogRegistry, catalogs, dataClient, onOpenFile])

  return null
}

// ---------------------------------------------------------------------------
// WorkspaceProvider props
// ---------------------------------------------------------------------------

export interface WorkspaceProviderProps {
  children: ReactNode
  chatPanel?: ComponentType<ChatPanelProps>
  plugins?: Plugin[]
  excludeDefaults?: string[]
  panels?: PanelConfig[]
  catalogs?: CatalogConfig[]
  capabilities?: Record<string, boolean>
  apiBaseUrl?: string
  authHeaders?: Record<string, string>
  /** Per-request timeout for the data layer's FetchClient, in ms. */
  apiTimeout?: number
  defaultTheme?: "light" | "dark" | undefined
  onThemeChange?: (theme: "light" | "dark") => void
  workspaceId?: string
  storageKey?: string
  persistenceEnabled?: boolean
  bridgeEndpoint?: string | null
  onAuthError?: (statusCode: number) => void
  onOpenFile?: (path: string) => void
}

// ---------------------------------------------------------------------------
// WorkspaceProvider
// ---------------------------------------------------------------------------

export function WorkspaceProvider({
  children,
  chatPanel,
  plugins,
  excludeDefaults,
  panels,
  catalogs,
  capabilities,
  apiBaseUrl = "",
  authHeaders,
  apiTimeout,
  defaultTheme,
  onThemeChange,
  workspaceId,
  storageKey,
  persistenceEnabled = true,
  bridgeEndpoint,
  onAuthError,
  onOpenFile,
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

  const { panelRegistry, commandRegistry, catalogRegistry } = useMemo(() => {
    const pr = new PanelRegistry(capabilities)
    const cr = new CommandRegistry()
    const cat = new CatalogRegistry()

    for (const panel of coreWorkspacePanels) {
      const { id, ...config } = panel
      pr.register(id, config)
    }

    bootstrap({
      chatPanel: chatPanel ?? NullChatPanel,
      plugins: plugins ?? [],
      defaults: [filesystemPlugin],
      excludeDefaults,
      registries: { panels: pr, commands: cr, catalogs: cat },
    })

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

    return { panelRegistry: pr, commandRegistry: cr, catalogRegistry: cat }
  }, [capabilities, chatPanel, plugins, excludeDefaults, panels, store])

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
  const workspaceValue = useMemo<WorkspaceContextValue>(
    () => ({ chatPanel: chatPanel ?? null }),
    [chatPanel],
  )

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <ThemeContext.Provider value={themeValue}>
        <WorkspaceBridgeContext.Provider value={bridgeValue}>
          {/*
           * Mount the data layer here so ChatCenteredShell/FileTreeView/etc.
           * work without hosts wrapping a second DataProvider. Hosts that DO
           * mount their own (legacy) get nested providers — inner wins, no
           * functional difference; just an extra wasted QueryClient.
           */}
          <DataProvider
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            onAuthError={onAuthError}
            timeout={apiTimeout}
          >
            <PluginErrorProvider>
              <RegistryProvider
                panelRegistry={panelRegistry}
                commandRegistry={commandRegistry}
                catalogRegistry={catalogRegistry}
              >
                <WorkspaceCatalogBindings
                  catalogs={catalogs}
                  onOpenFile={onOpenFile}
                />
                <WorkspaceShortcuts store={store} />
                <CommandPalette />
                <Toaster />
                {children}
              </RegistryProvider>
            </PluginErrorProvider>
          </DataProvider>
        </WorkspaceBridgeContext.Provider>
      </ThemeContext.Provider>
    </WorkspaceContext.Provider>
  )
}
