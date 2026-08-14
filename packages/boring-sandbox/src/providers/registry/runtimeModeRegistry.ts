import type {
  SandboxRuntimeModeDescriptorV1,
  SandboxRuntimeModeRegistryV1,
} from '../../shared/runtimeDescriptor'

/** Mutable builder kept behind the boring-sandbox registry export boundary. */
export class MutableSandboxRuntimeModeRegistryV1 implements SandboxRuntimeModeRegistryV1 {
  readonly #descriptors = new Map<string, SandboxRuntimeModeDescriptorV1>()

  constructor(descriptors: readonly SandboxRuntimeModeDescriptorV1[] = []) {
    for (const descriptor of descriptors) this.register(descriptor)
  }

  register(descriptor: SandboxRuntimeModeDescriptorV1): this {
    const id = descriptor.id.trim()
    if (!id) throw new Error('Sandbox runtime descriptor id is required')
    if (this.#descriptors.has(id)) {
      throw new Error(`Sandbox runtime descriptor "${id}" is already registered`)
    }
    if (descriptor.providerId !== descriptor.pair.sandboxProviderId) {
      throw new Error(
        `Sandbox runtime descriptor "${id}" must pair its declared provider with its Sandbox factory`,
      )
    }
    this.#descriptors.set(id, descriptor)
    return this
  }

  has(id: string): boolean {
    return this.#descriptors.has(id)
  }

  resolve(id: string): SandboxRuntimeModeDescriptorV1 {
    const descriptor = this.#descriptors.get(id)
    if (!descriptor) throw new Error(`Runtime mode "${id}" has no registered sandbox provider.`)
    return descriptor
  }

  find(id: string): SandboxRuntimeModeDescriptorV1 | undefined {
    return this.#descriptors.get(id)
  }

  list(): readonly SandboxRuntimeModeDescriptorV1[] {
    return Object.freeze([...this.#descriptors.values()])
  }
}
