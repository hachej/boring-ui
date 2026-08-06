import type { RuntimeFilesystemBinding } from './mode'
import { ErrorCode } from '../../shared/error-codes'

export const RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE = ErrorCode.enum.RUNTIME_FILESYSTEM_BINDING_DUPLICATE

export class RuntimeFilesystemBindingConfigurationError extends Error {
  readonly code = RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE
  readonly filesystem: string

  constructor(filesystem: string) {
    super(`filesystem binding is registered more than once: ${filesystem}`)
    this.name = 'RuntimeFilesystemBindingConfigurationError'
    this.filesystem = filesystem
  }
}

/**
 * Freeze the final binding list only after all host and request-scoped sources
 * have been merged. Array order must never decide filesystem authority.
 */
function assertUniqueRuntimeFilesystemBindings<T extends RuntimeFilesystemBinding>(
  bindings: readonly T[],
): readonly T[] {
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (seen.has(binding.filesystem)) {
      throw new RuntimeFilesystemBindingConfigurationError(binding.filesystem)
    }
    seen.add(binding.filesystem)
  }
  return bindings
}

/** Canonical final merge seam for runtime-owned and request-scoped bindings. */
export function mergeRuntimeFilesystemBindings<T extends RuntimeFilesystemBinding>(
  runtimeBindings: readonly T[] | undefined,
  requestBindings: readonly T[] | undefined,
): readonly T[] | undefined {
  const merged = [...(runtimeBindings ?? []), ...(requestBindings ?? [])]
  return merged.length > 0 ? assertUniqueRuntimeFilesystemBindings(merged) : undefined
}
