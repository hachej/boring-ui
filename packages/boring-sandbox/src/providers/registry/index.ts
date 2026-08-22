import type { SandboxRuntimeModeRegistryV1 } from '../../shared/runtimeDescriptor'
import {
  BUILTIN_RUNTIME_MODE_IDS,
  isBuiltinRuntimeModeId,
} from '../../shared/runtimeModeCatalog'
import { blaxelRuntimeDescriptor } from '../blaxel/runtimeDescriptor'
import { localRuntimeDescriptor } from '../bwrap/runtimeDescriptor'
import { directRuntimeDescriptor } from '../direct/runtimeDescriptor'
import { remoteWorkerRuntimeDescriptor } from '../remote-worker/runtimeDescriptor'
import { vercelSandboxRuntimeDescriptor } from '../vercel-sandbox/runtimeDescriptor'
import { createSandboxRuntimeModeRegistryV1 } from './runtimeModeRegistry'

export const BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS = Object.freeze([
  directRuntimeDescriptor,
  localRuntimeDescriptor,
  vercelSandboxRuntimeDescriptor,
  blaxelRuntimeDescriptor,
  remoteWorkerRuntimeDescriptor,
])

export const sandboxRuntimeModeRegistry: SandboxRuntimeModeRegistryV1 =
  createSandboxRuntimeModeRegistryV1(BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS)

for (const id of BUILTIN_RUNTIME_MODE_IDS) {
  if (!sandboxRuntimeModeRegistry.has(id)) {
    throw new Error(`Built-in runtime mode "${id}" has no registered descriptor`)
  }
}
for (const descriptor of sandboxRuntimeModeRegistry.list()) {
  if (!isBuiltinRuntimeModeId(descriptor.id)) {
    throw new Error(`Registered sandbox provider "${descriptor.id}" is missing from the built-in runtime mode catalog`)
  }
}

export { BUILTIN_RUNTIME_MODE_IDS, isBuiltinRuntimeModeId }

export function resolveSandboxRuntimeModeDescriptor(mode: string) {
  return sandboxRuntimeModeRegistry.resolve(mode)
}

export function findSandboxRuntimeModeDescriptor(mode: string) {
  return sandboxRuntimeModeRegistry.find(mode)
}
