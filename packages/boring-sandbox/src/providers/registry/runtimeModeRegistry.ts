import type {
  SandboxRuntimeModeDescriptorV1,
  SandboxRuntimeModeRegistryV1,
} from '../../shared/runtimeDescriptor'

/** Build a validated, immutable descriptor lookup. */
export function createSandboxRuntimeModeRegistryV1(
  descriptors: readonly SandboxRuntimeModeDescriptorV1[],
): SandboxRuntimeModeRegistryV1 {
  const descriptorsById = new Map<string, SandboxRuntimeModeDescriptorV1>()

  for (const descriptor of descriptors) {
    const id = descriptor.id.trim()
    if (!id) throw new Error('Sandbox runtime descriptor id is required')
    if (descriptorsById.has(id)) {
      throw new Error(`Sandbox runtime descriptor "${id}" is already registered`)
    }
    if (descriptor.providerId !== descriptor.pair.sandboxProviderId) {
      throw new Error(
        `Sandbox runtime descriptor "${id}" must pair its declared provider with its Sandbox factory`,
      )
    }
    descriptorsById.set(id, descriptor)
  }

  const descriptorList = Object.freeze([...descriptorsById.values()])
  return Object.freeze({
    has: (id: string) => descriptorsById.has(id),
    resolve(id: string) {
      const descriptor = descriptorsById.get(id)
      if (!descriptor) throw new Error(`Runtime mode "${id}" has no registered sandbox provider.`)
      return descriptor
    },
    find: (id: string) => descriptorsById.get(id),
    list: () => descriptorList,
  })
}
