import type { ComponentType } from "react"
import type { PanelConfig, PaneProps } from "../types/panel"
import type { SurfaceOpenRequest, SurfacePanelResolution } from "../types/surface"
import { defineFrontPlugin, type WorkspaceFrontPlugin } from "./defineFrontPlugin"
import type { LeftTabParams, PluginOutput } from "./types"

export interface BoringFrontPanelRegistration<T = unknown> {
  id: string
  component: ComponentType<PaneProps<T>> | (() => Promise<{ default: ComponentType<PaneProps<T>> }>)
  label?: string
  icon?: ComponentType<{ className?: string }>
  lazy?: boolean
  chromeless?: boolean
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
}

export interface BoringFrontSurfaceResolverRegistration {
  id?: string
  kind: string
  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | null | undefined
}

export interface BoringFrontAPI {
  registerPanel(registration: BoringFrontPanelRegistration): void
  registerPanelCommand(registration: BoringFrontPanelCommandRegistration): void
  registerLeftTab(registration: BoringFrontLeftTabRegistration): void
  registerSurfaceResolver(registration: BoringFrontSurfaceResolverRegistration): void
}

export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>

export interface CapturedBoringFrontRegistrations {
  panels: BoringFrontPanelRegistration[]
  panelCommands: BoringFrontPanelCommandRegistration[]
  leftTabs: BoringFrontLeftTabRegistration[]
  surfaceResolvers: BoringFrontSurfaceResolverRegistration[]
}

export interface CapturingBoringFrontAPIHandle extends BoringFrontAPI {
  flush(): CapturedBoringFrontRegistrations
}

function clone<T>(items: T[]): T[] {
  return [...items]
}

export function createCapturingBoringFrontAPI(): CapturingBoringFrontAPIHandle {
  const panels: BoringFrontPanelRegistration[] = []
  const panelCommands: BoringFrontPanelCommandRegistration[] = []
  const leftTabs: BoringFrontLeftTabRegistration[] = []
  const surfaceResolvers: BoringFrontSurfaceResolverRegistration[] = []

  return {
    registerPanel(registration) {
      panels.push(registration)
    },
    registerPanelCommand(registration) {
      panelCommands.push(registration)
    },
    registerLeftTab(registration) {
      leftTabs.push(registration)
    },
    registerSurfaceResolver(registration) {
      surfaceResolvers.push(registration)
    },
    flush() {
      return {
        panels: clone(panels),
        panelCommands: clone(panelCommands),
        leftTabs: clone(leftTabs),
        surfaceResolvers: clone(surfaceResolvers),
      }
    },
  }
}

function panelOutput(panel: BoringFrontPanelRegistration): PluginOutput {
  return {
    type: "panel",
    panel: {
      id: panel.id,
      title: panel.label ?? panel.id,
      component: panel.component,
      ...(panel.icon ? { icon: panel.icon } : {}),
      ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
      ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
      placement: "center",
      source: "plugin",
    },
  }
}

function EmptyLeftTab(_props: PaneProps<LeftTabParams>): null {
  return null
}

function leftTabOutput(pluginId: string, tab: BoringFrontLeftTabRegistration): PluginOutput {
  return {
    type: "left-tab",
    id: tab.id,
    title: tab.title,
    component: tab.component ?? EmptyLeftTab,
    ...(tab.icon ? { icon: tab.icon } : {}),
    ...(tab.lazy !== undefined ? { lazy: tab.lazy } : {}),
    ...(tab.chromeless !== undefined ? { chromeless: tab.chromeless } : {}),
    source: "plugin",
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

function resolverOutput(pluginId: string, resolver: BoringFrontSurfaceResolverRegistration): PluginOutput {
  return {
    type: "surface-resolver",
    resolver: {
      id: resolver.id ?? `${pluginId}:${resolver.kind}`,
      source: "plugin",
      resolve(request) {
        if (request.kind !== resolver.kind) return undefined
        return resolver.resolve(request) ?? undefined
      },
    },
  }
}

export function boringFrontFactoryToPlugin(
  id: string,
  factory: BoringFrontFactory,
): WorkspaceFrontPlugin {
  const api = createCapturingBoringFrontAPI()
  const result = factory(api)
  if (result && typeof (result as Promise<void>).then === "function") {
    throw new Error(`boringFrontFactoryToPlugin(${id}) requires a synchronous factory`)
  }

  const captured = api.flush()
  return defineFrontPlugin({
    id,
    outputs: [
      ...captured.panels.map(panelOutput),
      ...captured.leftTabs.map((tab) => leftTabOutput(id, tab)),
      ...captured.panelCommands.map(commandOutput),
      ...captured.surfaceResolvers.map((resolver) => resolverOutput(id, resolver)),
    ],
  })
}
