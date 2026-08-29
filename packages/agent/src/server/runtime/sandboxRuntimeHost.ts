/**
 * Server public surface for Agent-owned built-in provider composition.
 * Concrete provider imports stay in the package host boundary so the Agent
 * runtime source remains provider-neutral (enforced by package invariants).
 */
export {
  createRemoteWorkerModeAdapter,
  createSandboxRuntimeDescriptorAdapter,
  createSandboxRuntimeModeAdapter,
  findSandboxRuntimeModeDescriptor,
  getSandboxRuntimeModeDescriptor,
  resolveBuiltinRuntimeLayoutRoot,
  sandboxRuntimeHostOperations,
} from '../../../host/sandbox'
export type {
  RemoteWorkerModeAdapterOptions,
  SandboxRuntimeModeOptions,
} from '../../../host/sandbox'
