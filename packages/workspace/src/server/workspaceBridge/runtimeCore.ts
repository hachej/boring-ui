import { createWorkspaceBridgeRegistry, type WorkspaceBridgeHandler, type WorkspaceBridgeRegistry } from "./registry"
import type { WorkspaceBridgeOperationDefinition } from "../../shared/workspace-bridge-rpc"

export interface WorkspaceBridgeRuntimeCoreOptions {
  /** Reuse an existing registry; otherwise a fresh in-memory one is created. */
  registry?: WorkspaceBridgeRegistry
  /** Host/app/internal plugin bridge handlers to register at boot. */
  handlers?: ReadonlyArray<{ definition: WorkspaceBridgeOperationDefinition; handler: WorkspaceBridgeHandler }>
  /** Workspace that owns a newly-created registry. Ignored when registry is provided. */
  ownerWorkspaceId?: string
}

export interface WorkspaceBridgeRuntimeCore {
  registry: WorkspaceBridgeRegistry
}

/**
 * Shared bridge bootstrap: build/accept a registry and register host-supplied
 * bridge handlers. Domain handlers belong to the app/internal plugin that owns
 * the domain; workspace only owns the generic registry/runtime composition.
 */
export function createWorkspaceBridgeRuntimeCore(
  options: WorkspaceBridgeRuntimeCoreOptions = {},
): WorkspaceBridgeRuntimeCore {
  const registry = options.registry ?? createWorkspaceBridgeRegistry({ ownerWorkspaceId: options.ownerWorkspaceId })
  for (const entry of options.handlers ?? []) {
    registry.registerHandler(entry.definition, entry.handler)
  }
  return { registry }
}
