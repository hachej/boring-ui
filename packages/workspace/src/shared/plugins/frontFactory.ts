import type { ComponentType } from "react"
import type { PanelConfig, PaneProps } from "../types/panel"
import type { SurfaceOpenRequest, SurfacePanelResolution } from "../types/surface"
import { defineFrontPlugin, type WorkspaceFrontPlugin } from "./defineFrontPlugin"
import type {
  CatalogConfig,
  LeftTabParams,
  PluginBinding,
  PluginOutput,
  PluginProvider,
} from "./types"

export interface BoringFrontPanelRegistration<T = unknown> {
  id: string
  component: ComponentType<PaneProps<T>> | (() => Promise<{ default: ComponentType<PaneProps<T>> }>)
  label?: string
  icon?: ComponentType<{ className?: string }>
  placement?: string
  requiresCapabilities?: string[]
  essential?: boolean
  lazy?: boolean
  chromeless?: boolean
  source?: string
}

export interface BoringFrontPanelCommandRegistration {
  id: string
  title: string
  panelId: string
  run?: () => void
}

export interface BoringFrontLeftTabRegistration<T = LeftTabParams> {
  id: string
  title: string
  panelId: string
  icon?: ComponentType<{ className?: string }>
  component?: PanelConfig<T>["component"]
  lazy?: boolean
  chromeless?: boolean
  requiresCapabilities?: string[]
  source?: string
}

export interface BoringFrontProviderRegistration {
  id: string
  component: PluginProvider
}

export interface BoringFrontBindingRegistration {
  id: string
  component: PluginBinding
}

export interface BoringFrontSurfaceResolverRegistration {
  id?: string
  kind: string
  source?: string
  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | null | undefined
}

export interface BoringFrontAPI {
  registerProvider(registration: BoringFrontProviderRegistration): void
  registerBinding(registration: BoringFrontBindingRegistration): void
  registerCatalog(registration: CatalogConfig): void
  registerPanel<T = unknown>(registration: BoringFrontPanelRegistration<T>): void
  registerPanelCommand(registration: BoringFrontPanelCommandRegistration): void
  registerLeftTab<T = LeftTabParams>(registration: BoringFrontLeftTabRegistration<T>): void
  registerSurfaceResolver(registration: BoringFrontSurfaceResolverRegistration): void
}

export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>

export interface CapturedBoringFrontRegistrations {
  providers: BoringFrontProviderRegistration[]
  bindings: BoringFrontBindingRegistration[]
  catalogs: CatalogConfig[]
  panels: BoringFrontPanelRegistration<any>[]
  panelCommands: BoringFrontPanelCommandRegistration[]
  leftTabs: BoringFrontLeftTabRegistration<any>[]
  surfaceResolvers: BoringFrontSurfaceResolverRegistration[]
  outputs: PluginOutput[]
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
  const panelCommands: BoringFrontPanelCommandRegistration[] = []
  const leftTabs: BoringFrontLeftTabRegistration<any>[] = []
  const surfaceResolvers: BoringFrontSurfaceResolverRegistration[] = []
  const outputs: PluginOutput[] = []

  return {
    registerProvider(registration) {
      providers.push(registration)
      outputs.push({ type: "provider", id: registration.id, component: registration.component })
    },
    registerBinding(registration) {
      bindings.push(registration)
      outputs.push({ type: "binding", id: registration.id, component: registration.component })
    },
    registerCatalog(registration) {
      catalogs.push(registration)
      outputs.push({ type: "catalog", catalog: registration })
    },
    registerPanel(registration) {
      panels.push(registration)
      outputs.push(panelOutput(registration))
    },
    registerPanelCommand(registration) {
      panelCommands.push(registration)
      outputs.push(commandOutput(registration))
    },
    registerLeftTab(registration) {
      leftTabs.push(registration)
      outputs.push(leftTabOutput(registration))
    },
    registerSurfaceResolver(registration) {
      surfaceResolvers.push(registration)
      outputs.push(resolverOutput(registration, options.pluginId))
    },
    flush() {
      return {
        providers: clone(providers),
        bindings: clone(bindings),
        catalogs: clone(catalogs),
        panels: clone(panels),
        panelCommands: clone(panelCommands),
        leftTabs: clone(leftTabs),
        surfaceResolvers: clone(surfaceResolvers),
        outputs: clone(outputs),
      }
    },
  }
}

function panelOutput(panel: BoringFrontPanelRegistration<any>): PluginOutput {
  return {
    type: "panel",
    panel: {
      id: panel.id,
      title: panel.label ?? panel.id,
      component: panel.component,
      ...(panel.icon ? { icon: panel.icon } : {}),
      ...(panel.placement !== undefined ? { placement: panel.placement } : { placement: "center" }),
      ...(panel.requiresCapabilities !== undefined ? { requiresCapabilities: panel.requiresCapabilities } : {}),
      ...(panel.essential !== undefined ? { essential: panel.essential } : {}),
      ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
      ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
      source: panel.source ?? "plugin",
    },
  }
}

function EmptyLeftTab(_props: PaneProps<LeftTabParams>): null {
  return null
}

function leftTabOutput(tab: BoringFrontLeftTabRegistration<any>): PluginOutput {
  return {
    type: "left-tab",
    id: tab.id,
    title: tab.title,
    component: tab.component ?? EmptyLeftTab,
    ...(tab.icon ? { icon: tab.icon } : {}),
    ...(tab.lazy !== undefined ? { lazy: tab.lazy } : {}),
    ...(tab.chromeless !== undefined ? { chromeless: tab.chromeless } : {}),
    ...(tab.requiresCapabilities !== undefined ? { requiresCapabilities: tab.requiresCapabilities } : {}),
    source: tab.source ?? "plugin",
  }
}

function commandOutput(command: BoringFrontPanelCommandRegistration): PluginOutput {
  return {
    type: "command",
    command: {
      id: command.id,
      title: command.title,
      run: command.run ?? (() => undefined),
      keywords: [command.panelId],
    },
  }
}

function resolverOutput(resolver: BoringFrontSurfaceResolverRegistration, pluginId?: string): PluginOutput {
  return {
    type: "surface-resolver",
    resolver: {
      id: resolver.id ?? (pluginId ? `${pluginId}:${resolver.kind}` : resolver.kind),
      source: resolver.source ?? "plugin",
      resolve(request) {
        if (request.kind !== resolver.kind) return undefined
        return resolver.resolve(request) ?? undefined
      },
    },
  }
}

export interface BoringFrontFactoryToPluginOptions {
  label?: string
}

export function boringFrontFactoryToPlugin(
  id: string,
  factory: BoringFrontFactory,
  options: BoringFrontFactoryToPluginOptions = {},
): WorkspaceFrontPlugin {
  const api = createCapturingBoringFrontAPI({ pluginId: id })
  const result = factory(api)
  if (result && typeof (result as Promise<void>).then === "function") {
    throw new Error(`boringFrontFactoryToPlugin(${id}) requires a synchronous factory`)
  }

  const captured = api.flush()
  return defineFrontPlugin({
    id,
    ...(options.label ? { label: options.label } : {}),
    outputs: captured.outputs,
  })
}
