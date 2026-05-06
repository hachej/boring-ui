/**
 * Hot-reload coordinator for agent-authored plugins.
 *
 * Browser-safe: no node:* imports, no fs, no path.
 *
 * Responsibilities:
 *  - Validate manifests before loading.
 *  - Call the plugin factory to capture registrations.
 *  - Apply registrations to the provided registries atomically, with
 *    full rollback on any failure.
 *  - Track loaded plugins so unload can remove all their contributions.
 *  - Serialize concurrent loads for the same id via a per-id promise lock.
 */

import type { BoringPluginManifest } from "./manifest"
import type {
  BoringPluginAPI,
  BoringPluginCommandRegistration,
  BoringPluginContextProviderRegistration,
  BoringPluginPanelRegistration,
  BoringPluginSlotFillRegistration,
  BoringPluginSurfaceResolverRegistration,
} from "./authoring"
import { createCapturingAPI } from "./authoring"
import { validateBoringPluginManifest } from "./manifest"

// ---------------------------------------------------------------------------
// Registry interfaces
// ---------------------------------------------------------------------------

export interface CoordinatorPanelRegistry {
  /** Register a panel. Throws if the id already exists (registry-level rejection). */
  register(id: string, reg: Omit<BoringPluginPanelRegistration, "id"> & { pluginId: string }): void
  /** Remove all panels registered under pluginId. */
  unregisterByPluginId(pluginId: string): void
}

export interface CoordinatorCommandRegistry {
  /** Register a command. Throws if the id already exists (registry-level rejection). */
  registerCommand(reg: BoringPluginCommandRegistration & { pluginId: string }): void
  /** Remove all commands registered under pluginId. */
  unregisterByPluginId(pluginId: string): void
}

export interface CoordinatorSurfaceResolverRegistry {
  register(kind: string, reg: Omit<BoringPluginSurfaceResolverRegistration, "kind"> & { pluginId: string }): void
  unregisterByPluginId(pluginId: string): void
}

export interface CoordinatorProviderRegistry {
  register(reg: BoringPluginContextProviderRegistration & { pluginId: string }): void
  unregisterByPluginId(pluginId: string): void
}

export interface CoordinatorSlotFillRegistry {
  register(reg: BoringPluginSlotFillRegistration & { pluginId: string }): void
  unregisterByPluginId(pluginId: string): void
}

export interface CoordinatorRegistries {
  panels: CoordinatorPanelRegistry
  commands: CoordinatorCommandRegistry
  surfaceResolvers?: CoordinatorSurfaceResolverRegistry
  providers?: CoordinatorProviderRegistry
  slotFills?: CoordinatorSlotFillRegistry
}

// ---------------------------------------------------------------------------
// Plugin factory type
// ---------------------------------------------------------------------------

export type BoringPluginFactory = (api: BoringPluginAPI) => void | Promise<void>

// ---------------------------------------------------------------------------
// Runtime record
// ---------------------------------------------------------------------------

export interface BoringPluginRuntimeRecord {
  id: string
  manifest: BoringPluginManifest
  /** Unix epoch ms — use Date.now() for simplicity and serializability. */
  loadedAt: number
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DiagnosticKind = "error" | "warning" | "info"

export interface PluginDiagnostic {
  kind: DiagnosticKind
  message: string
  /** Optional structured payload for programmatic inspection. */
  detail?: unknown
}

export type LoadPluginResult =
  | { ok: true; record: BoringPluginRuntimeRecord; diagnostics: PluginDiagnostic[] }
  | { ok: false; diagnostics: PluginDiagnostic[] }

export type UnloadPluginResult =
  | { ok: true; diagnostics: PluginDiagnostic[] }
  | { ok: false; diagnostics: PluginDiagnostic[] }

// ---------------------------------------------------------------------------
// Internal error classification
// ---------------------------------------------------------------------------

type RegistrationPhase = "panels" | "commands" | "surfaceResolvers" | "providers" | "slotFills"

interface RegistrationError {
  /** "factory" — the plugin factory itself threw; "registry" — our own registry rejected. */
  origin: "factory" | "registry"
  phase: RegistrationPhase | "factory"
  error: unknown
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export interface PluginCoordinatorOptions {
  registries: CoordinatorRegistries
  /**
   * Plugin ids that are reserved by workspace internals.
   * Attempting to load a plugin with one of these ids will fail validation.
   */
  reservedIds?: string[]
}

export class PluginCoordinator {
  private readonly registries: CoordinatorRegistries
  private readonly reservedIds: ReadonlySet<string>

  /** Map of loaded plugin records, keyed by plugin id. */
  private readonly loaded = new Map<string, BoringPluginRuntimeRecord>()

  /**
   * Per-id promise lock.
   * While a load/unload for id X is in flight, any subsequent call for X
   * will wait for the current promise to settle before proceeding.
   */
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(options: PluginCoordinatorOptions) {
    this.registries = options.registries
    this.reservedIds = new Set(options.reservedIds ?? [])
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Load a plugin.
   *
   * If a load/unload for the same id is already in flight, this call will
   * wait for it to complete before proceeding (concurrent load race prevention).
   */
  async load(
    manifest: BoringPluginManifest,
    factory: BoringPluginFactory,
  ): Promise<LoadPluginResult> {
    const id = manifest.id
    const chain = this.locks.get(id) ?? Promise.resolve()
    const next = chain.then(() => this._load(manifest, factory))
    // Store the chained promise so the next caller waits on the full chain.
    // We store a version that never rejects so the chain stays alive.
    this.locks.set(id, next.then(() => undefined, () => undefined))
    return next
  }

  /**
   * Unload a plugin, removing all its contributions from the registries.
   *
   * Returns `{ ok: false }` with a warning if the plugin is not currently loaded.
   */
  async unload(id: string): Promise<UnloadPluginResult> {
    const chain = this.locks.get(id) ?? Promise.resolve()
    const next = chain.then(() => this._unload(id))
    this.locks.set(id, next.then(() => undefined, () => undefined))
    return next
  }

  /**
   * Return the runtime record for a loaded plugin, or undefined.
   */
  getRecord(id: string): BoringPluginRuntimeRecord | undefined {
    return this.loaded.get(id)
  }

  /**
   * Return all loaded plugin records.
   */
  listLoaded(): BoringPluginRuntimeRecord[] {
    return Array.from(this.loaded.values())
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id)
  }

  // -------------------------------------------------------------------------
  // Private — actual load logic (runs inside the per-id lock chain)
  // -------------------------------------------------------------------------

  private async _load(
    manifest: BoringPluginManifest,
    factory: BoringPluginFactory,
  ): Promise<LoadPluginResult> {
    const diagnostics: PluginDiagnostic[] = []
    const id = manifest.id

    // ---- Step 1: validate manifest (with reserved-id check) ---------------
    const validationResult = validateBoringPluginManifest(manifest, {
      reservedIds: [...this.reservedIds],
    })
    if (!validationResult.valid) {
      for (const issue of validationResult.issues) {
        diagnostics.push({
          kind: "error",
          message: `Manifest validation failed [${issue.code}] ${issue.field}: ${issue.message}`,
          detail: issue,
        })
      }
      return { ok: false, diagnostics }
    }

    // ---- Step 2: if already loaded, unload first --------------------------
    if (this.loaded.has(id)) {
      diagnostics.push({
        kind: "info",
        message: `Plugin "${id}" was already loaded; reloading.`,
      })
      this._removeFromRegistries(id)
      this.loaded.delete(id)
    }

    // ---- Step 3: call the factory to capture registrations ----------------
    const capturing = createCapturingAPI()

    let factoryError: RegistrationError | null = null
    try {
      await factory(capturing.api)
    } catch (err) {
      factoryError = { origin: "factory", phase: "factory", error: err }
    }

    if (factoryError) {
      diagnostics.push({
        kind: "error",
        message: `Plugin factory threw [factory-error]: ${String(factoryError.error)}`,
        detail: { origin: "factory", error: factoryError.error },
      })
      return { ok: false, diagnostics }
    }

    const captured = capturing.flush()

    // ---- Step 4: apply registrations with partial rollback ----------------
    const registrationError = await this._applyRegistrations(id, captured)

    if (registrationError) {
      // Roll back whatever was partially applied.
      this._removeFromRegistries(id)

      const originLabel = registrationError.origin === "factory"
        ? "factory-error"
        : "registry-error"
      diagnostics.push({
        kind: "error",
        message: `Plugin registration failed [${originLabel}] during phase "${registrationError.phase}": ${String(registrationError.error)}`,
        detail: registrationError,
      })
      return { ok: false, diagnostics }
    }

    // ---- Step 5: record success --------------------------------------------
    const record: BoringPluginRuntimeRecord = {
      id,
      manifest: validationResult.manifest,
      loadedAt: Date.now(),
    }
    this.loaded.set(id, record)

    return { ok: true, record, diagnostics }
  }

  private async _unload(id: string): Promise<UnloadPluginResult> {
    if (!this.loaded.has(id)) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "warning",
            message: `Plugin "${id}" is not currently loaded; nothing to unload.`,
          },
        ],
      }
    }

    this._removeFromRegistries(id)
    this.loaded.delete(id)

    return { ok: true, diagnostics: [] }
  }

  // -------------------------------------------------------------------------
  // Private — registration application
  // -------------------------------------------------------------------------

  private async _applyRegistrations(
    pluginId: string,
    captured: CapturedRegistrations,
  ): Promise<RegistrationError | null> {
    // Apply each phase. If any phase throws, return the error — the caller
    // will roll back everything via _removeFromRegistries.

    // panels
    for (const panel of captured.panels) {
      try {
        const { id, ...rest } = panel
        this.registries.panels.register(id, { ...rest, pluginId })
      } catch (err) {
        return {
          origin: _classifyError(err),
          phase: "panels",
          error: err,
        }
      }
    }

    // commands
    for (const command of captured.commands) {
      try {
        this.registries.commands.registerCommand({ ...command, pluginId })
      } catch (err) {
        return {
          origin: _classifyError(err),
          phase: "commands",
          error: err,
        }
      }
    }

    // surface resolvers
    if (this.registries.surfaceResolvers) {
      for (const resolver of captured.surfaceResolvers) {
        try {
          const { kind, ...rest } = resolver
          this.registries.surfaceResolvers.register(kind, { ...rest, pluginId })
        } catch (err) {
          return {
            origin: _classifyError(err),
            phase: "surfaceResolvers",
            error: err,
          }
        }
      }
    }

    // providers
    if (this.registries.providers) {
      for (const provider of captured.providers) {
        try {
          this.registries.providers.register({ ...provider, pluginId })
        } catch (err) {
          return {
            origin: _classifyError(err),
            phase: "providers",
            error: err,
          }
        }
      }
    }

    // slot fills
    if (this.registries.slotFills) {
      for (const fill of captured.slotFills) {
        try {
          this.registries.slotFills.register({ ...fill, pluginId })
        } catch (err) {
          return {
            origin: _classifyError(err),
            phase: "slotFills",
            error: err,
          }
        }
      }
    }

    return null
  }

  private _removeFromRegistries(pluginId: string): void {
    this.registries.panels.unregisterByPluginId(pluginId)
    this.registries.commands.unregisterByPluginId(pluginId)
    this.registries.surfaceResolvers?.unregisterByPluginId(pluginId)
    this.registries.providers?.unregisterByPluginId(pluginId)
    this.registries.slotFills?.unregisterByPluginId(pluginId)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic: if the thrown error has a `_registryRejection` marker (set by
 * well-behaved registry implementations) we classify it as a registry error.
 * Everything else is assumed to originate in plugin code.
 */
function _classifyError(err: unknown): "factory" | "registry" {
  if (
    err &&
    typeof err === "object" &&
    "_registryRejection" in (err as Record<string, unknown>) &&
    (err as Record<string, unknown>)._registryRejection === true
  ) {
    return "registry"
  }
  return "factory"
}

// ---------------------------------------------------------------------------
// Captured registrations shape — produced by createCapturingAPI
// ---------------------------------------------------------------------------

export interface CapturedRegistrations {
  panels: BoringPluginPanelRegistration[]
  commands: BoringPluginCommandRegistration[]
  surfaceResolvers: BoringPluginSurfaceResolverRegistration[]
  providers: BoringPluginContextProviderRegistration[]
  slotFills: BoringPluginSlotFillRegistration[]
}

// ---------------------------------------------------------------------------
// Public API aliases — use these in consumer code and @boring/workspace/plugin
// ---------------------------------------------------------------------------

/** @public Primary export name for the hot-reload coordinator. */
export { PluginCoordinator as BoringPluginReloadCoordinator }
export type { PluginCoordinatorOptions as BoringPluginReloadCoordinatorOptions }
export type { CoordinatorRegistries as BoringPluginContributionRegistries }
export type { CoordinatorPanelRegistry as HotReloadPanelRegistryLike }
export type { CoordinatorCommandRegistry as HotReloadCommandRegistryLike }
export type { CoordinatorSurfaceResolverRegistry as HotReloadSurfaceResolverRegistryLike }
export type { LoadPluginResult as BoringPluginReloadResult }
export type { PluginDiagnostic as BoringPluginReloadDiagnostic }
