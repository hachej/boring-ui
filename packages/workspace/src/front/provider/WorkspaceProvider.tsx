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
import { CommandRegistry } from "../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../shared/plugins/SurfaceResolverRegistry"
import { RegistryProvider, useCatalogRegistry, useCommandRegistry } from "../registry/RegistryProvider"
import { CatalogRegistry } from "../../shared/plugins/CatalogRegistry"
import { PluginErrorProvider } from "../plugin/PluginErrorContext"
import { PluginInspector } from "../plugin/PluginInspector"
import { FullPageBasePathProvider } from "../fullPage"
import { createWorkspaceStore } from "../store"
import { bindStore, useThemePreference } from "../store/selectors"
import { createBridge } from "../bridge/createBridge"
import { createBridgeClient, type BridgeClient } from "../bridge/client"
import { PanelRenderStatusProvider } from "../registry/PanelRenderStatusBoundary"
import { CommandPalette } from "../components/CommandPalette"
import { events, workspaceEvents } from "../events"
import { Toaster } from "../toast"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { bootstrap } from "../../shared/plugins/bootstrap"
import { filesystemPlugin } from "../../plugins/filesystemPlugin/front"
import { coreWorkspacePanels } from "../registry/coreRegistrations"
import type {
  PluginBinding,
  PluginProvider,
} from "../../shared/plugins/types"
import type { BoringFrontFactoryWithId, CapturedFrontPlugin } from "../../shared/plugins/frontFactory"
import type { CommandConfig, PanelConfig } from "../registry/types"
import type { CatalogConfig } from "../../shared/plugins/types"
import type { WorkspaceChatPanelComponent, WorkspaceChatPanelProps } from "../chrome/chat/types"
import { WorkspaceAttentionProvider } from "../attention"
import { useAgentPluginHotReload } from "../agentPlugins/registerAgentPlugin"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function NullChatPanel(_props: WorkspaceChatPanelProps) {
  return null
}

export type FrontPluginHotReloadMode = "vite" | false

function AgentPluginHotReloadBridge(props: { apiBaseUrl: string; workspaceId?: string; mode: FrontPluginHotReloadMode; authHeaders?: Record<string, string> }) {
  useAgentPluginHotReload({
    apiBaseUrl: props.apiBaseUrl,
    workspaceId: props.workspaceId,
    authHeaders: props.authHeaders,
    enabled: props.mode === "vite",
  })
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
}

export interface WorkspaceContextValue {
  chatPanel: WorkspaceChatPanelComponent | null
  registeredPlugins: RegisteredPluginMeta[]
  debug: boolean
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

function WorkspacePluginBindings({ plugins }: { plugins: CapturedFrontPlugin[] }) {
  return (
    <>
      {plugins.flatMap((plugin) =>
        plugin.registrations.bindings.map((binding) => {
          const Binding = binding.component as PluginBinding
          return <Binding key={`${plugin.id}:${binding.id}`} />
        }),
      )}
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
  plugins: CapturedFrontPlugin[]
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  apiTimeout?: number
  children: ReactNode
}) {
  const providers = plugins.flatMap((plugin) =>
    plugin.registrations.providers.map((provider) => ({ plugin, provider })),
  )

  return providers.reduceRight<ReactNode>((acc, { plugin, provider }) => {
    const Provider = provider.component as PluginProvider
    return (
      <Provider
        key={`${plugin.id}:provider:${provider.id}`}
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
  /**
   * Front plugin entries produced by `definePlugin({ id, ... })` from
   * `@hachej/boring-workspace/plugin`.
   */
  plugins?: BoringFrontFactoryWithId[]
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
  debug?: boolean
  /**
   * Hot-load dynamically discovered front plugin modules. The current
   * implementation relies on Vite's /@fs transform endpoint, so it defaults to
   * dev-only. Production hosts should keep this false until they provide their
   * own module asset endpoint.
   */
  frontPluginHotReload?: FrontPluginHotReloadMode
  fullPageBasePath?: string
}

// ---------------------------------------------------------------------------
// WorkspaceProvider
// ---------------------------------------------------------------------------

function scopedAuthHeaders(
  workspaceId: string | undefined,
  authHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!workspaceId) return authHeaders
  if (
    authHeaders?.["x-boring-workspace-id"] != null ||
    authHeaders?.["X-Boring-Workspace-Id"] != null
  ) {
    return authHeaders
  }
  return { "x-boring-workspace-id": workspaceId, ...authHeaders }
}

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
  debug = false,
  frontPluginHotReload = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ? 'vite' as const : false,
  fullPageBasePath,
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
    const defaultPlugins: BoringFrontFactoryWithId[] = excludedDefaults.has(filesystemPlugin.pluginId)
      ? []
      : [filesystemPlugin]
    const userPlugins = plugins ?? []

    const bootstrapResult = bootstrap({
      chatPanel: chatPanel ?? NullChatPanel,
      plugins: userPlugins,
      defaults: defaultPlugins,
      excludeDefaults,
      registries: { panels: pr, commands: cr, catalogs: cat, surfaceResolvers: sr },
    })

    const metas: RegisteredPluginMeta[] = [
      { id: "workspace:chat-layout", label: "Layout" },
      { id: "agent:chat-layout", label: "Layout" },
      ...bootstrapResult.plugins.map((p) => ({
        id: p.id,
        label: p.label,
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
      pluginsWithBindings: bootstrapResult.plugins,
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

  const resolvedAuthHeaders = useMemo(
    () => scopedAuthHeaders(workspaceId, authHeaders),
    [authHeaders, workspaceId],
  )

  const [bridgeConnected, setBridgeConnected] = useState(false)

  const bridgeValue = useMemo<WorkspaceBridgeContextValue>(
    () => ({ connected: bridgeConnected }),
    [bridgeConnected],
  )
  const workspaceValue = useMemo<WorkspaceContextValue>(
    () => ({ chatPanel: chatPanel ?? null, registeredPlugins: pluginMetas, debug }),
    [chatPanel, pluginMetas, debug],
  )

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <ThemeContext.Provider value={themeValue}>
        <WorkspaceBridgeContext.Provider value={bridgeValue}>
          <FullPageBasePathProvider basePath={fullPageBasePath}>
            <WorkspaceAttentionProvider>
          <PluginErrorProvider>
            <RegistryProvider
              panelRegistry={panelRegistry}
              commandRegistry={commandRegistry}
              catalogRegistry={catalogRegistry}
              surfaceResolverRegistry={surfaceResolverRegistry}
            >
              <PanelRenderStatusProvider apiBaseUrl={apiBaseUrl} workspaceId={workspaceId} authHeaders={resolvedAuthHeaders}>
              <WorkspacePluginProviders
                plugins={pluginsWithBindings}
                apiBaseUrl={apiBaseUrl}
                authHeaders={resolvedAuthHeaders}
                onAuthError={onAuthError}
                apiTimeout={apiTimeout}
              >
                <WorkspacePluginBindings plugins={pluginsWithBindings} />
                <AgentPluginHotReloadBridge apiBaseUrl={apiBaseUrl} workspaceId={workspaceId} mode={frontPluginHotReload} authHeaders={resolvedAuthHeaders} />
                <WorkspaceOpenFileBinding onOpenFile={onOpenFile} />
                <WorkspaceCommandBindings commands={commands} />
                <WorkspaceCatalogBindings
                  catalogs={catalogs}
                />
                <WorkspaceShortcuts store={store} />
                <CommandPalette />
                <Toaster />
                {children}
                {(typeof import.meta !== 'undefined' && import.meta.env?.DEV) && <PluginInspector plugins={pluginMetas} />}
              </WorkspacePluginProviders>
              </PanelRenderStatusProvider>
            </RegistryProvider>
          </PluginErrorProvider>
          </WorkspaceAttentionProvider>
          </FullPageBasePathProvider>
        </WorkspaceBridgeContext.Provider>
      </ThemeContext.Provider>
    </WorkspaceContext.Provider>
  )
}
