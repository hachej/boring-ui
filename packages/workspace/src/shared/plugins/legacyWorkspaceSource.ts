import { createElement, type ComponentType } from "react"
import type {
  PaneProps,
  WorkspaceSourceOpenPanelConfig,
  WorkspaceSourceProps,
  WorkspaceSourceRegistration,
} from "../types/panel"

type LegacyPanelComponent = ComponentType<PaneProps<any>>
type LegacyPanelImporter = () => Promise<{ default: LegacyPanelComponent }>

function toOpenPanelConfig(raw: unknown): WorkspaceSourceOpenPanelConfig | null {
  if (!raw || typeof raw !== "object") return null
  const input = raw as { id?: unknown; component?: unknown; title?: unknown; params?: unknown }
  const component = typeof input.component === "string"
    ? input.component
    : typeof input.id === "string"
      ? input.id
      : undefined
  const id = typeof input.id === "string" ? input.id : component
  if (!id || !component) return null
  return {
    id,
    component,
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(input.params && typeof input.params === "object" ? { params: input.params as Record<string, unknown> } : {}),
  }
}

function unsupportedLegacyApiAccess(id: string, surface: string, property: string | symbol): never {
  throw new Error(
    `Legacy workspace source panel "${id}" cannot use Dockview ${surface}.${String(property)}. ` +
      "Use registerWorkspaceSource and the explicit openPanel callback instead.",
  )
}

function createLegacyContainerApi(id: string, openPanel: WorkspaceSourceProps<any>["openPanel"]): PaneProps["containerApi"] {
  const target = {
    addPanel(config: unknown) {
      const next = toOpenPanelConfig(config)
      if (next) openPanel?.(next)
      return undefined
    },
  }
  return new Proxy(target, {
    get(current, property) {
      if (property === "addPanel") return current.addPanel
      if (property === "then") return undefined
      return unsupportedLegacyApiAccess(id, "containerApi", property)
    },
  }) as unknown as PaneProps["containerApi"]
}

function createUnsupportedLegacyPanelApi(id: string): PaneProps["api"] {
  return new Proxy({}, {
    get(_current, property) {
      if (property === "then") return undefined
      return unsupportedLegacyApiAccess(id, "api", property)
    },
  }) as PaneProps["api"]
}

function makeLegacyWorkspaceSourceComponent(
  id: string,
  _title: string,
  LegacyPanel: LegacyPanelComponent,
): ComponentType<WorkspaceSourceProps<any>> {
  function LegacyWorkspaceSource(props: WorkspaceSourceProps<any>) {
    return createElement(LegacyPanel, {
      params: props.params,
      className: props.className,
      api: createUnsupportedLegacyPanelApi(id),
      containerApi: createLegacyContainerApi(id, props.openPanel),
    })
  }
  LegacyWorkspaceSource.displayName = `LegacyWorkspaceSource(${id})`
  return LegacyWorkspaceSource
}

/**
 * Backwards-compatibility adapter for older plugins/apps that registered left
 * rail sources as `registerPanel({ placement: "left-tab" | "workspace-source" })`.
 * New code should use `registerWorkspaceSource`; this adapter is only the
 * registration-boundary shim, so the WorkbenchLeftPane host itself stays on the
 * explicit WorkspaceSourceProps contract.
 */
export function adaptLegacyPanelToWorkspaceSource(
  id: string,
  title: string,
  component: LegacyPanelComponent | LegacyPanelImporter,
  lazy?: boolean,
): WorkspaceSourceRegistration["component"] {
  if (lazy) {
    return async () => {
      const mod = await (component as LegacyPanelImporter)()
      return { default: makeLegacyWorkspaceSourceComponent(id, title, mod.default) }
    }
  }
  return makeLegacyWorkspaceSourceComponent(id, title, component as LegacyPanelComponent)
}
