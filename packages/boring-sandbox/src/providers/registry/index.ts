import { SandboxRuntimeModeRegistryV1 } from '../../shared/runtimeDescriptor'
import {
  BUILTIN_RUNTIME_MODE_IDS,
  isBuiltinRuntimeModeId,
} from '../../shared/runtimeModeCatalog'
import { blaxelRuntimeDescriptor } from '../blaxel/runtimeDescriptor'
import { localRuntimeDescriptor } from '../bwrap/runtimeDescriptor'
import { directRuntimeDescriptor } from '../direct/runtimeDescriptor'
import { remoteWorkerRuntimeDescriptor } from '../remote-worker/runtimeDescriptor'
import { vercelSandboxRuntimeDescriptor } from '../vercel-sandbox/runtimeDescriptor'

export const BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS = Object.freeze([
  directRuntimeDescriptor,
  localRuntimeDescriptor,
  vercelSandboxRuntimeDescriptor,
  blaxelRuntimeDescriptor,
  remoteWorkerRuntimeDescriptor,
])

export const sandboxRuntimeModeRegistry = new SandboxRuntimeModeRegistryV1(
  BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS,
)

for (const id of BUILTIN_RUNTIME_MODE_IDS) {
  if (!sandboxRuntimeModeRegistry.has(id)) {
    throw new Error(`Built-in runtime mode "${id}" has no registered descriptor`)
  }
}

export { BUILTIN_RUNTIME_MODE_IDS, isBuiltinRuntimeModeId }

export function resolveSandboxRuntimeModeDescriptor(mode: string) {
  return sandboxRuntimeModeRegistry.resolve(mode)
}
