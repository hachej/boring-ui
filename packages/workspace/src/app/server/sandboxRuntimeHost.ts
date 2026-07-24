/**
 * Compatibility shim. Built-in runtime adapters are Agent-owned; existing
 * Workspace/Core/CLI imports continue to resolve without a migration flag day.
 */
export {
  createSandboxRuntimeModeAdapter,
  sandboxRuntimeHostOperations,
} from '@hachej/boring-agent/server'
export type { SandboxRuntimeModeOptions } from '@hachej/boring-agent/server'
