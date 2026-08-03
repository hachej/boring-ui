import type { ComponentType, ReactNode } from "react"
import type { PanelConfig, PaneProps, WorkspaceSourceProps } from "../types/panel"
import type { SurfaceOpenRequest, SurfacePanelResolution, SurfaceResolverExample, SurfaceResolverRegistration } from "../types/surface"
import { PluginError } from "./errors"
import type {
  CatalogConfig,
  PluginBinding,
  PluginProvider,
} from "./types"

export interface BoringFrontPanelRegistration<T = unknown> {
  id: string
  component: ComponentType<PaneProps<T>> | (() => Promise<{ default: ComponentType<PaneProps<T>> }>)
  label?: string
  icon?: ComponentType<{ className?: string }>
  placement?: PanelConfig["placement"]
  requiresCapabilities?: string[]
  essential?: boolean
  lazy?: boolean
  chromeless?: boolean
  supportsFullPage?: boolean
  source?: string
}

export interface BoringFrontWorkspaceSourceRegistration<T = unknown> {
  id: string
  component: ComponentType<WorkspaceSourceProps<T>> | (() => Promise<{ default: ComponentType<WorkspaceSourceProps<T>> }>)
  label?: string
  icon?: ComponentType<{ className?: string }>
  requiresCapabilities?: string[]
  lazy?: boolean
  chromeless?: boolean
  defaultPanelId?: string
  source?: string
}

export interface BoringFrontPanelCommandRegistration {
  id: string
  title: string
  panelId?: string
  run?: () => void
  keywords?: string[]
  shortcut?: string
  when?: () => boolean
}

export interface BoringFrontProviderRegistration {
  id: string
  component: PluginProvider
}

export interface BoringFrontBindingRegistration {
  id: string
  component: PluginBinding
}

export interface BoringFrontAppLeftOverlayProps {
  onClose: () => void
  params?: Readonly<Record<string, string>>
}

export interface BoringFrontAppLeftActionRegistration {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  trailing?: ComponentType
  overlay: ComponentType<BoringFrontAppLeftOverlayProps>
  order?: number
  emphasis?: boolean
}

export interface BoringFrontSurfaceResolverRegistration {
  id?: string
  kind: string
  title?: string
  description?: string
  targetHint?: string
  examples?: SurfaceResolverExample[]
  metaSchema?: Record<string, unknown>
  source?: string
  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | null | undefined
}

export function normalizeFrontSurfaceResolver(
  resolver: BoringFrontSurfaceResolverRegistration,
  pluginId: string,
): { id: string; config: SurfaceResolverRegistration } {
  const id = resolver.id ?? `${pluginId}:${resolver.kind}`
  return {
    id,
    config: {
      kind: resolver.kind,
      ...(resolver.title !== undefined ? { title: resolver.title } : {}),
      ...(resolver.description !== undefined ? { description: resolver.description } : {}),
      ...(resolver.targetHint !== undefined ? { targetHint: resolver.targetHint } : {}),
      ...(resolver.examples !== undefined ? { examples: resolver.examples } : {}),
      ...(resolver.metaSchema !== undefined ? { metaSchema: resolver.metaSchema } : {}),
      source: resolver.source ?? "plugin",
      pluginId,
      resolve(request: SurfaceOpenRequest) {
        if (request.kind !== resolver.kind) return undefined
        return resolver.resolve(request) ?? undefined
      },
    },
  }
}

export type BoringFrontToolRenderer = (part: unknown) => ReactNode

export interface BoringFrontToolRendererRegistration {
  id: string
  render: BoringFrontToolRenderer
}

export interface BoringFrontAPI {
  registerProvider(registration: BoringFrontProviderRegistration): void
  registerBinding(registration: BoringFrontBindingRegistration): void
  registerCatalog(registration: CatalogConfig): void
  registerPanel<T = unknown>(registration: BoringFrontPanelRegistration<T>): void
  registerWorkspaceSource<T = unknown>(registration: BoringFrontWorkspaceSourceRegistration<T>): void
  registerPanelCommand(registration: BoringFrontPanelCommandRegistration): void
  registerAppLeftAction(registration: BoringFrontAppLeftActionRegistration): void
  registerSurfaceResolver(registration: BoringFrontSurfaceResolverRegistration): void
  registerToolRenderer(registration: BoringFrontToolRendererRegistration): void
}

export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>
export type BoringFrontSetup = (api: BoringFrontAPI) => void

type RejectAsyncSetup<C> = C extends { setup?: infer Setup }
  ? Setup extends (...args: any[]) => infer Return
    ? Extract<Return, PromiseLike<unknown>> extends never
      ? unknown
      : never
    : unknown
  : unknown

/**
 * A `BoringFrontFactory` that carries its own plugin id (and optional
 * label) as static properties. Produced by `definePlugin({ ... })` and used
 * directly by `WorkspaceProvider.plugins`.
 */
export type BoringFrontFactoryWithId = BoringFrontFactory & {
  pluginId: string
  pluginLabel?: string
}

/**
 * Declarative plugin config — the canonical shape for `definePlugin`.
 */
export interface DefinePluginConfig {
  id: string
  label?: string
  panels?: ReadonlyArray<BoringFrontPanelRegistration<any>>
  workspaceSources?: ReadonlyArray<BoringFrontWorkspaceSourceRegistration<any>>
  commands?: ReadonlyArray<BoringFrontPanelCommandRegistration>
  appLeftActions?: ReadonlyArray<BoringFrontAppLeftActionRegistration>
  surfaceResolvers?: ReadonlyArray<BoringFrontSurfaceResolverRegistration>
  providers?: ReadonlyArray<BoringFrontProviderRegistration>
  bindings?: ReadonlyArray<BoringFrontBindingRegistration>
  catalogs?: ReadonlyArray<CatalogConfig>
  toolRenderers?: ReadonlyArray<BoringFrontToolRendererRegistration>
  /**
   * Escape hatch for registrations that can't be expressed declaratively.
   * Called LAST, after every declarative field has been registered.
   */
  setup?: BoringFrontSetup
}

/**
 * Define a boring-ui plugin. Takes a single declarative config object and
 * returns a branded front factory.
 *
 * Older positional signatures are not supported. The `setup` field is
 * synchronous so statically composed plugins cannot return a Promise during
 * provider bootstrap.
 */
export function definePlugin<const Config extends DefinePluginConfig>(
  config: Config & RejectAsyncSetup<Config>,
): BoringFrontFactoryWithId {
  if (typeof config !== "object" || config === null) {
    if (typeof config === "string" || typeof config === "function") {
      throw new Error(
        "definePlugin now takes a single declarative config object: " +
          "definePlugin({ id, label?, panels, commands, surfaceResolvers, setup? }). " +
          "The legacy positional form was removed — use the new shape.",
      )
    }
    throw new Error("definePlugin: expected a config object")
  }
  if (typeof config.id !== "string" || config.id.length === 0) {
    throw new Error("definePlugin: `id` is required and must be a non-empty string")
  }
  const factory: BoringFrontFactory = (api) => {
    for (const panel of config.panels ?? []) api.registerPanel(panel)
    for (const source of config.workspaceSources ?? []) api.registerWorkspaceSource(source)
    for (const command of config.commands ?? []) api.registerPanelCommand(command)
    for (const action of config.appLeftActions ?? []) api.registerAppLeftAction(action)
    for (const resolver of config.surfaceResolvers ?? []) api.registerSurfaceResolver(resolver)
    for (const provider of config.providers ?? []) api.registerProvider(provider)
    for (const binding of config.bindings ?? []) api.registerBinding(binding)
    for (const catalog of config.catalogs ?? []) api.registerCatalog(catalog)
    for (const renderer of config.toolRenderers ?? []) api.registerToolRenderer(renderer)
    if (config.setup) config.setup(api)
    return undefined
  }
  return brandFactoryWithPluginId(config.id, factory, { label: config.label })
}

function brandFactoryWithPluginId(
  id: string,
  factory: BoringFrontFactory,
  options: { label?: string },
): BoringFrontFactoryWithId {
  const existing = (factory as Partial<BoringFrontFactoryWithId>).pluginId
  if (existing !== undefined && existing !== id) {
    throw new Error(`definePlugin: factory already branded as "${existing}", cannot rebrand as "${id}"`)
  }
  const wrapper = ((api) => factory(api)) as BoringFrontFactoryWithId
  Object.defineProperty(wrapper, "pluginId", { value: id, enumerable: true })
  if (options.label !== undefined) {
    Object.defineProperty(wrapper, "pluginLabel", { value: options.label, enumerable: true })
  }
  return wrapper
}

export interface CapturedBoringFrontRegistrations {
  providers: BoringFrontProviderRegistration[]
  bindings: BoringFrontBindingRegistration[]
  catalogs: CatalogConfig[]
  panels: BoringFrontPanelRegistration<any>[]
  workspaceSources: BoringFrontWorkspaceSourceRegistration<any>[]
  panelCommands: BoringFrontPanelCommandRegistration[]
  appLeftActions: BoringFrontAppLeftActionRegistration[]
  surfaceResolvers: BoringFrontSurfaceResolverRegistration[]
  toolRenderers: BoringFrontToolRendererRegistration[]
}

export interface CapturedFrontPlugin {
  id: string
  label?: string
  registrations: CapturedBoringFrontRegistrations
}

export interface CapturingBoringFrontAPIHandle extends BoringFrontAPI {
  flush(): CapturedBoringFrontRegistrations
}

function clone<T>(items: T[]): T[] {
  return [...items]
}

export function createCapturingBoringFrontAPI(options: { pluginId?: string } = {}): CapturingBoringFrontAPIHandle {
  const providers: BoringFrontProviderRegistration[] = []
  const bindings: BoringFrontBindingRegistration[] = []
  const catalogs: CatalogConfig[] = []
  const panels: BoringFrontPanelRegistration<any>[] = []
  const workspaceSources: BoringFrontWorkspaceSourceRegistration<any>[] = []
  const panelCommands: BoringFrontPanelCommandRegistration[] = []
  const appLeftActions: BoringFrontAppLeftActionRegistration[] = []
  const surfaceResolvers: BoringFrontSurfaceResolverRegistration[] = []
  const toolRenderers: BoringFrontToolRendererRegistration[] = []
  // Intra-plugin id collision detection (PLUGIN_SYSTEM.md §5.7): two register*
  // calls in the same factory chain landing the same id are silent
  // last-write-wins in the atomic-replace path. Catch them at capture time.
  const seen = new Map<string, string>()
  const claim = (kind: string, id: string) => {
    const key = `${kind}:${id}`
    const prior = seen.get(key)
    if (prior !== undefined) {
      const owner = options.pluginId ?? "<plugin>"
      throw new PluginError(
        "duplicate-id",
        `plugin "${owner}" registers ${kind} "${id}" twice (first as ${prior}, then again). ` +
          "If you are composing kits, two of them are registering the same id — namespace one of them.",
      )
    }
    seen.set(key, `${kind} "${id}"`)
  }

  return {
    registerProvider(registration) {
      claim("provider", registration.id)
      providers.push(registration)
    },
    registerBinding(registration) {
      claim("binding", registration.id)
      bindings.push(registration)
    },
    registerCatalog(registration) {
      claim("catalog", registration.id)
      catalogs.push(registration)
    },
    registerPanel(registration) {
      if (registration.placement === "left-tab" || registration.placement === "workspace-source") {
        throw new PluginError(
          "validation",
          `plugin "${options.pluginId ?? "<plugin>"}" uses removed panel placement "${registration.placement}" for "${registration.id}". ` +
            "Use registerWorkspaceSource / definePlugin({ workspaceSources }) instead.",
        )
      }
      claim("panel", registration.id)
      panels.push(registration)
    },
    registerWorkspaceSource(registration) {
      claim("workspace-source", registration.id)
      workspaceSources.push(registration)
    },
    registerPanelCommand(registration) {
      claim("command", registration.id)
      panelCommands.push(registration)
    },
    registerAppLeftAction(registration) {
      claim("app-left-action", registration.id)
      appLeftActions.push(registration)
    },
    registerSurfaceResolver(registration) {
      const id = registration.id ?? `${options.pluginId ?? "anon"}:${registration.kind}`
      claim("surface-resolver", id)
      surfaceResolvers.push({ ...registration, id })
    },
    registerToolRenderer(registration) {
      claim("tool-renderer", registration.id)
      toolRenderers.push(registration)
    },
    flush() {
      return {
        providers: clone(providers),
        bindings: clone(bindings),
        catalogs: clone(catalogs),
        panels: clone(panels),
        workspaceSources: clone(workspaceSources),
        panelCommands: clone(panelCommands),
        appLeftActions: clone(appLeftActions),
        surfaceResolvers: clone(surfaceResolvers),
        toolRenderers: clone(toolRenderers),
      }
    },
  }
}

export function captureFrontPlugin(plugin: BoringFrontFactoryWithId): CapturedFrontPlugin {
  if (typeof plugin !== "function" || typeof plugin.pluginId !== "string" || plugin.pluginId.length === 0) {
    throw new Error(
      "WorkspaceProvider.plugins accepts plugins created by definePlugin({ id, ... }). " +
        "Received a front plugin without a pluginId.",
    )
  }
  const api = createCapturingBoringFrontAPI({ pluginId: plugin.pluginId })
  const result = plugin(api)
  if (result && typeof (result as Promise<void>).then === "function") {
    throw new Error(`captureFrontPlugin(${plugin.pluginId}) requires a synchronous factory`)
  }
  return {
    id: plugin.pluginId,
    ...(plugin.pluginLabel !== undefined ? { label: plugin.pluginLabel } : {}),
    registrations: api.flush(),
  }
}
