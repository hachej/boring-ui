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
import { PanelRegistry } from "../registry/PanelRegistry"
import { CommandRegistry } from "../registry/CommandRegistry"
import { SurfaceResolverRegistry } from "../registry/SurfaceResolverRegistry"
import { RegistryProvider, useCatalogRegistry, useCommandRegistry } from "../registry/RegistryProvider"
import { CatalogRegistry } from "../plugin/CatalogRegistry"
import { PluginErrorProvider } from "../plugin/PluginErrorContext"
import { PluginInspector } from "../plugin/PluginInspector"
import { createWorkspaceStore } from "../store"
import { bindStore, useThemePreference } from "../store/selectors"
import { createBridge } from "../bridge/createBridge"
import { createBridgeClient, type BridgeClient } from "../bridge/client"
import { CommandPalette } from "../components/CommandPalette"
import { events, workspaceEvents } from "../events"
import { Toaster } from "../toast"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { bootstrap } from "../../shared/plugins/bootstrap"
import { filesystemPlugin } from "../../plugins/filesystemPlugin/front"
import { coreWorkspacePanels } from "../registry/coreRegistrations"
import type {
  BindingOutput,
  ProviderOutput,
} from "../../shared/plugins/types"
import type { WorkspaceFrontPlugin } from "../../shared/plugins/defineFrontPlugin"
import type { CommandConfig, PanelConfig } from "../registry/types"
import type { CatalogConfig } from "../../shared/plugins/types"
import type { WorkspaceChatPanelComponent, WorkspaceChatPanelProps } from "../chrome/chat/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function NullChatPanel(_props: WorkspaceChatPanelProps) {
  return null
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

const PROVIDER_CATALOG_SOURCE = "workspace-provider"
const PROVIDER_COMMAND_SOURCE = "workspace-provider"

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

export interface RegisteredPluginMeta {
  id: string
  label?: string
  systemPrompt?: string
}

export interface WorkspaceContextValue {
  chatPanel: WorkspaceChatPanelComponent | null
  registeredPlugins: RegisteredPluginMeta[]
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspaceContext must be used within a WorkspaceProvider")
  return ctx
}

export function useWorkspaceContextOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}

export function useWorkspaceChatPanel(): WorkspaceChatPanelComponent {
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

function WorkspaceCommandBindings({ commands }: { commands?: CommandConfig[] }) {
  const commandRegistry = useCommandRegistry()

  useEffect(() => {
    if (!commands?.length) return
    const ids = commands.map((command) => command.id)
    for (const id of ids) commandRegistry.unregisterCommand(id)
    for (const command of commands) {
      commandRegistry.registerCommand({ ...command, pluginId: command.pluginId ?? PROVIDER_COMMAND_SOURCE })
    }
    return () => {
      for (const id of ids) commandRegistry.unregisterCommand(id)
    }
  }, [commandRegistry, commands])

  return null
}

function WorkspaceCatalogBindings({
  catalogs,
}: {
  catalogs?: CatalogConfig[]
}) {
  const catalogRegistry = useCatalogRegistry()

  useEffect(() => {
    if (!catalogs?.length) return
    for (const catalog of catalogs) {
      catalogRegistry.register(catalog, PROVIDER_CATALOG_SOURCE)
    }

    return () => {
      catalogRegistry.unregisterByPluginId(PROVIDER_CATALOG_SOURCE)
    }
  }, [catalogRegistry, catalogs])

  return null
}

function WorkspacePluginBindings({ plugins }: { plugins: WorkspaceFrontPlugin[] }) {
  return (
    <>
      {plugins.map((plugin) => {
        const outputBindings =
          plugin.outputs?.filter(
            (output): output is BindingOutput => output.type === "binding",
          ) ?? []
        return [
          ...(plugin.bindings ?? []).map((Binding, index) => (
            <Binding key={`${plugin.id}:binding:${index}`} />
          )),
          ...outputBindings.map((output) => {
            const Binding = output.component
            return <Binding key={`${plugin.id}:output:${output.id}`} />
          }),
        ]
      })}
    </>
  )
}

function WorkspacePluginProviders({
  plugins,
  apiBaseUrl,
  authHeaders,
  onAuthError,
  apiTimeout,
  children,
}: {
  plugins: WorkspaceFrontPlugin[]
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  apiTimeout?: number
  children: ReactNode
}) {
  const providers = plugins.flatMap((plugin) =>
    plugin.outputs
      ?.filter((output): output is ProviderOutput => output.type === "provider")
      .map((output) => ({ plugin, output })) ?? [],
  )

  return providers.reduceRight<ReactNode>((acc, { plugin, output }) => {
    const Provider = output.component
    return (
      <Provider
        key={`${plugin.id}:provider:${output.id}`}
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        onAuthError={onAuthError}
        apiTimeout={apiTimeout}
      >
        {acc}
      </Provider>
    )
  }, children)
}

function WorkspaceOpenFileBinding({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  useEffect(() => {
    if (!onOpenFile) return
    return events.on(workspaceEvents.uiCommand, ({ command }) => {
      if (command.kind !== "openFile") return
      const path = command.params.path
      if (typeof path === "string") onOpenFile(path)
    })
  }, [onOpenFile])

  return null
}

// ---------------------------------------------------------------------------
// WorkspaceProvider props
// ---------------------------------------------------------------------------

export interface WorkspaceProviderProps {
  children: ReactNode
  chatPanel?: WorkspaceChatPanelComponent
  plugins?: WorkspaceFrontPlugin[]
  excludeDefaults?: string[]
  panels?: PanelConfig[]
  commands?: CommandConfig[]
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
  commands,
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

  const { panelRegistry, commandRegistry, catalogRegistry, surfaceResolverRegistry, pluginMetas, pluginsWithBindings } = useMemo(() => {
    const pr = new PanelRegistry(capabilities)
    const cr = new CommandRegistry()
    const cat = new CatalogRegistry()
    const sr = new SurfaceResolverRegistry()

    for (const panel of coreWorkspacePanels) {
      const { id, ...config } = panel
      pr.register(id, config)
    }

    const excludedDefaults = new Set(excludeDefaults ?? [])
    const defaultPlugins: WorkspaceFrontPlugin[] = excludedDefaults.has(filesystemPlugin.id)
      ? []
      : [filesystemPlugin]
    const allPlugins = [...defaultPlugins, ...(plugins ?? [])]

    bootstrap({
      chatPanel: chatPanel ?? NullChatPanel,
      plugins: plugins ?? [],
      defaults: defaultPlugins,
      excludeDefaults,
      registries: { panels: pr, commands: cr, catalogs: cat, surfaceResolvers: sr },
    })

    const metas: RegisteredPluginMeta[] = [
      { id: "workspace:chat-layout", label: "Layout" },
      { id: "agent:chat-layout", label: "Layout" },
      ...allPlugins.map((p) => ({
        id: p.id,
        label: p.label,
        systemPrompt: p.systemPrompt,
      })),
    ]

    if (panels) {
      for (const panel of panels) {
        const { id, ...config } = panel
        pr.register(id, config)
      }
    }

    return {
      panelRegistry: pr,
      commandRegistry: cr,
      catalogRegistry: cat,
      surfaceResolverRegistry: sr,
      pluginMetas: metas,
      pluginsWithBindings: allPlugins,
    }
  }, [capabilities, chatPanel, plugins, excludeDefaults, panels])

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
    () => ({ chatPanel: chatPanel ?? null, registeredPlugins: pluginMetas }),
    [chatPanel, pluginMetas],
  )

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <ThemeContext.Provider value={themeValue}>
        <WorkspaceBridgeContext.Provider value={bridgeValue}>
          <PluginErrorProvider>
            <RegistryProvider
              panelRegistry={panelRegistry}
              commandRegistry={commandRegistry}
              catalogRegistry={catalogRegistry}
              surfaceResolverRegistry={surfaceResolverRegistry}
            >
              <WorkspacePluginProviders
                plugins={pluginsWithBindings}
                apiBaseUrl={apiBaseUrl}
                authHeaders={authHeaders}
                onAuthError={onAuthError}
                apiTimeout={apiTimeout}
              >
                <WorkspacePluginBindings plugins={pluginsWithBindings} />
                <WorkspaceOpenFileBinding onOpenFile={onOpenFile} />
                <WorkspaceCommandBindings commands={commands} />
                <WorkspaceCatalogBindings
                  catalogs={catalogs}
                />
                <WorkspaceShortcuts store={store} />
                <CommandPalette />
                <Toaster />
                {children}
                {import.meta.env.DEV && <PluginInspector plugins={pluginMetas} />}
              </WorkspacePluginProviders>
            </RegistryProvider>
          </PluginErrorProvider>
        </WorkspaceBridgeContext.Provider>
      </ThemeContext.Provider>
    </WorkspaceContext.Provider>
  )
}
