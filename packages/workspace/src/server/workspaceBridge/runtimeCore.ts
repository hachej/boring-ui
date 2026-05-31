import { createWorkspaceBridgeRegistry, type WorkspaceBridgeRegistry, type WorkspaceBridgeHandler } from "./registry"
import type { WorkspaceBridgeOperationDefinition } from "../../shared/workspace-bridge-rpc"
import { createHumanInputBridgeHandlers, type HumanInputBridgeHandlersOptions } from "../humanInput/humanInputBridgeHandlers"
import { PendingQuestionRuntime } from "../humanInput/pendingQuestionRuntime"
import { InMemoryPendingQuestionStore, type PendingQuestionStore } from "../humanInput/pendingQuestionStore"

export interface WorkspaceBridgeRuntimeCoreOptions {
  /** Reuse an existing registry; otherwise a fresh in-memory one is created. */
  registry?: WorkspaceBridgeRegistry
  /** Reuse an existing pending-question store; otherwise an in-memory one is created. */
  pendingQuestionStore?: PendingQuestionStore
  /** Reuse an existing pending-question runtime; otherwise one is created over the store. */
  pendingQuestionRuntime?: PendingQuestionRuntime
  /** Additional (caller-supplied) bridge handlers registered after human-input. */
  handlers?: ReadonlyArray<{ definition: WorkspaceBridgeOperationDefinition; handler: WorkspaceBridgeHandler }>
  /** Resolve the owning principal for a session (multi-tenant ownership checks). */
  resolveOwnerPrincipalId?: HumanInputBridgeHandlersOptions["resolveOwnerPrincipalId"]
  /** Abandon pending questions owned by a now-dead process at boot. Default true. */
  abandonOnRestart?: boolean
}

export interface WorkspaceBridgeRuntimeCore {
  registry: WorkspaceBridgeRegistry
  pendingQuestionStore: PendingQuestionStore
  pendingQuestionRuntime: PendingQuestionRuntime
}

/**
 * Shared bridge bootstrap: build/accept a registry + pending-question
 * store/runtime, abandon stale pending state at boot, then register the
 * human-input handlers followed by any caller-supplied handlers. Used by both
 * the workspace and core app servers so the ordering invariant lives once.
 */
export function createWorkspaceBridgeRuntimeCore(
  options: WorkspaceBridgeRuntimeCoreOptions = {},
): WorkspaceBridgeRuntimeCore {
  const pendingQuestionStore = options.pendingQuestionStore ?? new InMemoryPendingQuestionStore()
  const pendingQuestionRuntime = options.pendingQuestionRuntime ?? new PendingQuestionRuntime(pendingQuestionStore)
  const effectiveStore = pendingQuestionRuntime.store
  if (options.abandonOnRestart ?? true) void pendingQuestionRuntime.abandonServerRestart()

  const registry = options.registry ?? createWorkspaceBridgeRegistry()
  for (const entry of createHumanInputBridgeHandlers({
    runtime: pendingQuestionRuntime,
    store: effectiveStore,
    resolveOwnerPrincipalId: options.resolveOwnerPrincipalId,
  })) {
    registry.registerHandler(entry.definition, entry.handler)
  }
  for (const entry of options.handlers ?? []) {
    registry.registerHandler(entry.definition, entry.handler)
  }

  return { registry, pendingQuestionStore: effectiveStore, pendingQuestionRuntime }
}
