import type { RuntimeFilesystemBinding, RuntimeFilesystemCapability } from './mode'
import { ErrorCode } from '../../shared/error-codes'
import { intersectRuntimeFilesystemAccessDecisions } from './readonlyFilesystemPolicy'

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

const MUTATION_CAPABILITY: Record<string, RuntimeFilesystemCapability> = {
  write: 'write',
  writeBinary: 'write',
  createBinary: 'write',
  delete: 'delete',
  mkdir: 'create-child',
}

/**
 * Intersect a host-owned binding with a request-scoped binding for the same
 * filesystem id. The request binding performs the IO (it carries governance
 * scoping), but every mutation is first authorized against the host policy, so
 * request governance can only ever narrow host capabilities, never widen them.
 */
function intersectRuntimeFilesystemBinding(
  host: RuntimeFilesystemBinding,
  request: RuntimeFilesystemBinding,
): RuntimeFilesystemBinding {
  const authorize = async (
    capability: RuntimeFilesystemCapability,
    descriptor: { filesystem: string; path: string },
  ): Promise<void> => {
    if (host.access === 'readonly') host.operations.rejectMutation(capability, descriptor)
    const decision = await host.operations.resolveAccess?.(descriptor)
    if (decision && !decision.capabilities[capability]) host.operations.rejectMutation(capability, descriptor)
  }
  const guarded = <Args extends { filesystem: string; path: string }, Result>(
    method: ((args: Args) => Promise<Result>) | undefined,
    capability: RuntimeFilesystemCapability,
  ) => (method
    ? async (args: Args): Promise<Result> => {
        await authorize(capability, args)
        return await method(args)
      }
    : undefined)

  return {
    filesystem: host.filesystem,
    access: host.access === 'readonly' || request.access === 'readonly' ? 'readonly' : 'readwrite',
    operations: {
      ...request.operations,
      write: guarded(request.operations.write?.bind(request.operations), MUTATION_CAPABILITY.write!),
      writeBinary: guarded(request.operations.writeBinary?.bind(request.operations), MUTATION_CAPABILITY.writeBinary!),
      createBinary: guarded(request.operations.createBinary?.bind(request.operations), MUTATION_CAPABILITY.createBinary!),
      delete: guarded(request.operations.delete?.bind(request.operations), MUTATION_CAPABILITY.delete!),
      mkdir: guarded(request.operations.mkdir?.bind(request.operations), MUTATION_CAPABILITY.mkdir!),
      move: request.operations.move
        ? async (args) => {
            await authorize('move-from', { filesystem: args.filesystem, path: args.from })
            await authorize('write', { filesystem: args.filesystem, path: args.to })
            return await request.operations.move!(args)
          }
        : undefined,
      resolveAccess: async (descriptor) => {
        const hostDecision = await host.operations.resolveAccess?.(descriptor)
        const requestDecision = await request.operations.resolveAccess?.(descriptor)
        if (!hostDecision) return requestDecision ?? { filesystem: descriptor.filesystem, normalizedPath: descriptor.path, access: request.access, capabilities: { read: true, write: request.access === 'readwrite', 'create-child': request.access === 'readwrite', delete: request.access === 'readwrite', 'move-from': request.access === 'readwrite' } }
        if (!requestDecision) return hostDecision
        return intersectRuntimeFilesystemAccessDecisions(hostDecision, requestDecision)
      },
      rejectMutation: (operation, descriptor) => host.operations.rejectMutation(operation, descriptor),
    },
  }
}

/**
 * Canonical final merge seam for runtime-owned and request-scoped bindings.
 * Duplicates *within* either list stay configuration errors; a host/request
 * collision on the same id composes as an intersection of both capabilities.
 */
export function mergeRuntimeFilesystemBindings<T extends RuntimeFilesystemBinding>(
  runtimeBindings: readonly T[] | undefined,
  requestBindings: readonly T[] | undefined,
): readonly RuntimeFilesystemBinding[] | undefined {
  const runtime = assertUniqueRuntimeFilesystemBindings(runtimeBindings ?? [])
  const requested = assertUniqueRuntimeFilesystemBindings(requestBindings ?? [])
  const byId = new Map<string, RuntimeFilesystemBinding>(runtime.map((binding) => [binding.filesystem, binding]))
  for (const binding of requested) {
    const host = byId.get(binding.filesystem)
    byId.set(binding.filesystem, host ? intersectRuntimeFilesystemBinding(host, binding) : binding)
  }
  return byId.size > 0 ? [...byId.values()] : undefined
}
