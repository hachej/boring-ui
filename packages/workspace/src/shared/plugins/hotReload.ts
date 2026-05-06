/**
 * Hot-reload coordinator for agent-authored plugins.
 *
 * Browser-safe: no node:* imports, no fs, no path.
 * Registry types are duck-typed interfaces so this module does not import
 * concrete registry classes from the front layer.
 */
import type {
  BoringPluginAPI,
  BoringPluginCommandRegistration,
  BoringPluginContextProviderRegistration,
  BoringPluginPanelRegistration,
  BoringPluginSlotFillRegistration,
  BoringPluginSurfaceResolverRegistration,
} from "./authoring"
import type { BoringPluginManifest } from "./manifest"

// ---------------------------------------------------------------------------
// Duck-typed registry interfaces
// ---------------------------------------------------------------------------

/** Minimal panel registry surface required by the coordinator. */
export interface HotReloadPanelRegistryLike {
  register(id: string, config: object): void
  unregisterByPluginId(pluginId: string): void
}

/** Minimal command registry surface required by the coordinator. */
export interface HotReloadCommandRegistryLike {
  registerCommand(id: string, config: object): void
  unregisterByPluginId(pluginId: string): void
}

/** Minimal surface resolver registry surface required by the coordinator. */
export interface HotReloadSurfaceResolverRegistryLike {
  register(id: string, config: object): void
  unregisterByPluginId(pluginId: string): void
}

// ---------------------------------------------------------------------------
// Contribution registries bag
// ---------------------------------------------------------------------------

export interface BoringPluginContributionRegistries {
  panels: HotReloadPanelRegistryLike
  commands: HotReloadCommandRegistryLike
  surfaceResolvers: HotReloadSurfaceResolverRegistryLike
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/** A plugin factory function as authored by the agent. */
export type BoringPluginFactory = (api: BoringPluginAPI) => void | Promise<void>

// ---------------------------------------------------------------------------
// Captured registrations
// ---------------------------------------------------------------------------

export interface BoringPluginCapturedRegistrations {
  panels: BoringPluginPanelRegistration[]
  commands: BoringPluginCommandRegistration[]
  surfaceResolvers: BoringPluginSurfaceResolverRegistration[]
  providers: BoringPluginContextProviderRegistration[]
  slotFills: BoringPluginSlotFillRegistration[]
}

// ---------------------------------------------------------------------------
// Runtime record
// ---------------------------------------------------------------------------

export interface BoringPluginRuntimeRecord {
  id: string
  manifest?: BoringPluginManifest
  registrations: BoringPluginCapturedRegistrations
  loadedAt: number
}

// ---------------------------------------------------------------------------
// Reload input / result
// ---------------------------------------------------------------------------

export interface BoringPluginReloadInput {
  id: string
  factory: BoringPluginFactory
  manifest?: BoringPluginManifest
}

export interface BoringPluginReloadDiagnostic {
  kind: "error" | "warning"
  message: string
}

export interface BoringPluginReloadResult {
  ok: boolean
  diagnostics: BoringPluginReloadDiagnostic[]
}

// ---------------------------------------------------------------------------
// Coordinator options
// ---------------------------------------------------------------------------

export interface BoringPluginReloadCoordinatorOptions {
  registries: BoringPluginContributionRegistries
  onReload?: (id: string, result: BoringPluginReloadResult) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an empty captured-registrations object. */
export function createEmptyBoringPluginRegistrations(): BoringPluginCapturedRegistrations {
  return {
    panels: [],
    commands: [],
    surfaceResolvers: [],
    providers: [],
    slotFills: [],
  }
}

/**
 * Runs a plugin factory with a capturing {@link BoringPluginAPI} and returns
 * everything it registered.
 */
export async function captureBoringPluginRegistrations(
  factory: BoringPluginFactory,
): Promise<BoringPluginCapturedRegistrations> {
  const captured = createEmptyBoringPluginRegistrations()

  const api: BoringPluginAPI = {
    panels: {
      register(reg) {
        captured.panels.push(reg)
      },
    },
    commands: {
      register(reg) {
        captured.commands.push(reg)
      },
    },
    surfaceResolvers: {
      register(reg) {
        captured.surfaceResolvers.push(reg)
      },
    },
    providers: {
      register(reg) {
        captured.providers.push(reg)
      },
    },
    slotFills: {
      register(reg) {
        captured.slotFills.push(reg)
      },
    },
  }

  await factory(api)
  return captured
}

// ---------------------------------------------------------------------------
// BoringPluginReloadCoordinator
// ---------------------------------------------------------------------------

/**
 * Loads, unloads, and hot-reloads agent-authored plugins into the workspace
 * contribution registries.
 *
 * - **load**: captures registrations from the factory then pushes them into
 *   the registries. If the plugin is already loaded, it unloads first
 *   (atomic swap). If any registry.register call throws, all contributions
 *   for this plugin are rolled back via `unregisterByPluginId`.
 * - **unload**: calls `unregisterByPluginId` on all registries for the plugin.
 * - **list**: returns all currently-loaded runtime records.
 */
export class BoringPluginReloadCoordinator {
  private readonly registries: BoringPluginContributionRegistries
  private readonly onReload?: (id: string, result: BoringPluginReloadResult) => void
  private readonly records = new Map<string, BoringPluginRuntimeRecord>()

  constructor(opts: BoringPluginReloadCoordinatorOptions) {
    this.registries = opts.registries
    this.onReload = opts.onReload
  }

  /**
   * Captures registrations from `input.factory` and commits them into the
   * contribution registries.
   *
   * If the plugin is already loaded, it is atomically unloaded first.
   * If any registration throws, the plugin's contributions are rolled back.
   */
  async load(input: BoringPluginReloadInput): Promise<BoringPluginReloadResult> {
    const { id } = input
    const diagnostics: BoringPluginReloadDiagnostic[] = []

    // Capture registrations from factory
    let captured: BoringPluginCapturedRegistrations
    try {
      captured = await captureBoringPluginRegistrations(input.factory)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : String(err)
      const result: BoringPluginReloadResult = {
        ok: false,
        diagnostics: [{ kind: "error", message: `Plugin factory threw: ${message}` }],
      }
      this.onReload?.(id, result)
      return result
    }

    // If already loaded, unload first (atomic swap — remove before re-registering)
    if (this.records.has(id)) {
      this._unregisterFromRegistries(id)
      this.records.delete(id)
    }

    // Register into real registries, rolling back on any error
    try {
      for (const reg of captured.panels) {
        this.registries.panels.register(reg.id, {
          title: reg.label,
          component: reg.component,
          pluginId: id,
        })
      }
      for (const reg of captured.commands) {
        this.registries.commands.registerCommand(reg.id, {
          title: reg.label,
          shortcut: reg.shortcut,
          run: reg.handler,
          pluginId: id,
        })
      }
      for (const reg of captured.surfaceResolvers) {
        this.registries.surfaceResolvers.register(reg.kind, {
          resolve: reg.resolve,
          pluginId: id,
        })
      }
    } catch (err) {
      // Rollback all registrations for this plugin
      this._unregisterFromRegistries(id)
      const message = err instanceof Error ? err.message : String(err)
      const result: BoringPluginReloadResult = {
        ok: false,
        diagnostics: [
          ...diagnostics,
          { kind: "error", message: `Registry registration failed (rolled back): ${message}` },
        ],
      }
      this.onReload?.(id, result)
      return result
    }

    // Store the runtime record
    const record: BoringPluginRuntimeRecord = {
      id,
      manifest: input.manifest,
      registrations: captured,
      loadedAt: Date.now(),
    }
    this.records.set(id, record)

    const result: BoringPluginReloadResult = { ok: true, diagnostics }
    this.onReload?.(id, result)
    return result
  }

  /**
   * Unloads a plugin by calling `unregisterByPluginId` on all registries.
   */
  unload(id: string): BoringPluginReloadResult {
    if (!this.records.has(id)) {
      return {
        ok: false,
        diagnostics: [{ kind: "error", message: `Plugin "${id}" is not loaded` }],
      }
    }

    this._unregisterFromRegistries(id)
    this.records.delete(id)
    return { ok: true, diagnostics: [] }
  }

  /** Returns all currently-loaded plugin runtime records. */
  list(): BoringPluginRuntimeRecord[] {
    return Array.from(this.records.values())
  }

  /** Returns the runtime record for a specific plugin id, or undefined. */
  getRecord(id: string): BoringPluginRuntimeRecord | undefined {
    return this.records.get(id)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _unregisterFromRegistries(id: string): void {
    try {
      this.registries.panels.unregisterByPluginId(id)
    } catch {
      // best-effort
    }
    try {
      this.registries.commands.unregisterByPluginId(id)
    } catch {
      // best-effort
    }
    try {
      this.registries.surfaceResolvers.unregisterByPluginId(id)
    } catch {
      // best-effort
    }
  }
}
