/**
 * Authoring surface handed to agent-authored plugins.
 *
 * Browser-safe: no node:* imports, no fs, no path.
 * These types describe the API object passed to a plugin factory at load time.
 */
import type { ComponentType, ReactNode } from "react"
import type { SurfacePanelResolution } from "../types/surface"

// ---------------------------------------------------------------------------
// Registration shapes
// ---------------------------------------------------------------------------

/** A lazy import factory that resolves to a default-exported React component. */
export type PluginPanelComponentFactory<P = unknown> = () => Promise<{
  default: ComponentType<P>
}>

/** Registration for a panel contributed by an agent-authored plugin. */
export interface BoringPluginPanelRegistration {
  /** Unique panel identifier scoped to the plugin. */
  id: string
  /** Human-readable panel title shown in tab headers. */
  label: string
  /**
   * Direct React component or lazy import factory.
   * When a factory is provided the runtime will call it and use the default export.
   */
  component: ComponentType<unknown> | PluginPanelComponentFactory
}

/** Registration for a keyboard command contributed by an agent-authored plugin. */
export interface BoringPluginCommandRegistration {
  /** Unique command identifier scoped to the plugin. */
  id: string
  /** Human-readable label shown in the command palette. */
  label: string
  /** Optional keyboard shortcut string e.g. "Ctrl+Shift+P". */
  shortcut?: string
  /** Callback invoked when the command is triggered. */
  handler: () => void | Promise<void>
}

/** A surface resolution request passed to resolver plugins. */
export interface BoringPluginSurfaceRequest {
  /** Surface kind e.g. "file", "table", "url". */
  kind: string
  /** Context-specific payload, shape depends on kind. */
  payload: unknown
}

/** The resolution returned by a surface resolver plugin. */
export interface BoringPluginSurfaceResolution {
  /** Id of the panel to open. */
  panelId: string
  /** Optional params forwarded to the panel component. */
  params?: unknown
}

/** Registration for a surface resolver contributed by an agent-authored plugin. */
export interface BoringPluginSurfaceResolverRegistration {
  /** Surface kind this resolver handles e.g. "file". */
  kind: string
  /**
   * Resolve a surface request into a panel/params pair, or return null when
   * this resolver cannot handle the request.
   *
   * The return type is `SurfacePanelResolution | null` — import from
   * `../../shared/types/surface` if you need the full shape.
   */
  resolve: (
    req: BoringPluginSurfaceRequest,
  ) => SurfacePanelResolution | null
}

/** Registration for a React context provider contributed by an agent-authored plugin. */
export interface BoringPluginContextProviderRegistration {
  /** Unique provider identifier. */
  id: string
  /** Component that wraps children with the provided context. */
  component: ComponentType<{ children: ReactNode }>
}

/** Registration for a slot fill contributed by an agent-authored plugin. */
export interface BoringPluginSlotFillRegistration {
  /** The slot id this fill targets. */
  slot: string
  /** Component rendered inside the slot. */
  component: ComponentType<unknown>
}

// ---------------------------------------------------------------------------
// BoringPluginAPI — the object passed to plugin factories
// ---------------------------------------------------------------------------

/**
 * The API object injected into plugin factory functions.
 *
 * Each namespace exposes a `register` method for contributing the relevant
 * extension type. Registrations are captured and applied atomically by the
 * coordinator — the factory should call register synchronously.
 *
 * Double-registering the same panel id or command id within one factory call
 * throws immediately — plugin authors should not silently overwrite earlier
 * registrations.
 */
export interface BoringPluginAPI {
  panels: {
    register(registration: BoringPluginPanelRegistration): void
  }
  commands: {
    register(registration: BoringPluginCommandRegistration): void
  }
  surfaceResolvers: {
    register(registration: BoringPluginSurfaceResolverRegistration): void
  }
  providers: {
    register(registration: BoringPluginContextProviderRegistration): void
  }
  slotFills: {
    register(registration: BoringPluginSlotFillRegistration): void
  }
}

// ---------------------------------------------------------------------------
// Capturing implementation — used by the coordinator
// ---------------------------------------------------------------------------

import type { CapturedRegistrations } from "./coordinator"

export interface CapturingAPIHandle {
  api: BoringPluginAPI
  /** Drain and return all captured registrations. Call once after factory returns. */
  flush(): CapturedRegistrations
}

/**
 * Create a capturing `BoringPluginAPI` that records all `register` calls.
 *
 * Double-registering the same panel id or command id throws immediately so
 * plugin authors get a clear error instead of a silent overwrite.
 */
export function createCapturingAPI(): CapturingAPIHandle {
  const panels: BoringPluginPanelRegistration[] = []
  const commands: BoringPluginCommandRegistration[] = []
  const surfaceResolvers: BoringPluginSurfaceResolverRegistration[] = []
  const providers: BoringPluginContextProviderRegistration[] = []
  const slotFills: BoringPluginSlotFillRegistration[] = []

  // Track ids to detect doubles within one factory call.
  const panelIds = new Set<string>()
  const commandIds = new Set<string>()

  const api: BoringPluginAPI = {
    panels: {
      register(reg) {
        if (panelIds.has(reg.id)) {
          throw new Error(
            `[BoringPlugin] panel id "${reg.id}" was already registered in this factory call. Each panel id must be unique within a plugin.`,
          )
        }
        panelIds.add(reg.id)
        panels.push(reg)
      },
    },
    commands: {
      register(reg) {
        if (commandIds.has(reg.id)) {
          throw new Error(
            `[BoringPlugin] command id "${reg.id}" was already registered in this factory call. Each command id must be unique within a plugin.`,
          )
        }
        commandIds.add(reg.id)
        commands.push(reg)
      },
    },
    surfaceResolvers: {
      register(reg) {
        surfaceResolvers.push(reg)
      },
    },
    providers: {
      register(reg) {
        providers.push(reg)
      },
    },
    slotFills: {
      register(reg) {
        slotFills.push(reg)
      },
    },
  }

  return {
    api,
    flush(): CapturedRegistrations {
      return {
        panels: [...panels],
        commands: [...commands],
        surfaceResolvers: [...surfaceResolvers],
        providers: [...providers],
        slotFills: [...slotFills],
      }
    },
  }
}
