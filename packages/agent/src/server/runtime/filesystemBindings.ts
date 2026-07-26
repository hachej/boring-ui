import type { JsonValue } from '../../shared/index'
import { digestRuntimeIdentityValue } from '../agent-host/runtimeScopeIdentity'
import {
  RUNTIME_FILESYSTEM_CAPABILITIES,
  type RuntimeFilesystemAccessDecision,
  type RuntimeFilesystemBinding,
  type RuntimeFilesystemCapability,
} from './mode'

export const RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE = 'RUNTIME_FILESYSTEM_BINDING_DUPLICATE'
export const RUNTIME_FILESYSTEM_BINDING_SOURCE_INVALID_CODE = 'RUNTIME_FILESYSTEM_BINDING_SOURCE_INVALID'

export class RuntimeFilesystemBindingConfigurationError extends Error {
  readonly code = RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE
  readonly filesystem: string

  constructor(filesystem: string) {
    super(`filesystem binding is registered more than once: ${filesystem}`)
    this.name = 'RuntimeFilesystemBindingConfigurationError'
    this.filesystem = filesystem
  }
}

export class RuntimeFilesystemBindingSourceError extends Error {
  readonly code = RUNTIME_FILESYSTEM_BINDING_SOURCE_INVALID_CODE

  constructor() {
    super('runtime filesystem binding source identity is invalid')
    this.name = 'RuntimeFilesystemBindingSourceError'
  }
}

/**
 * Freeze the final binding list only after all host and request-scoped sources
 * have been merged. Array order must never decide filesystem authority.
 */
export function assertUniqueRuntimeFilesystemBindings<T extends RuntimeFilesystemBinding>(
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

export type RuntimeFilesystemBindingSourceRole = 'host' | 'governance' | 'supplemental'

export interface RuntimeFilesystemBindingSource {
  /** Stable server-private owner identity, for example runtime, agent_resources, or a readonly mount provider. */
  readonly owner: string
  /** Stable owner revision. It must change whenever that owner's binding policy changes. */
  readonly generation: string
  readonly role: RuntimeFilesystemBindingSourceRole
  readonly bindings: readonly RuntimeFilesystemBinding[]
}

export interface RuntimeFilesystemBindingSnapshot {
  readonly generation: string
  readonly bindings: readonly RuntimeFilesystemBinding[]
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableGeneration(value: JsonValue): string {
  return `filesystem-bindings-v1-${digestRuntimeIdentityValue(value)}`
}

export function createRuntimeFilesystemBindingsGeneration(
  bindings: readonly RuntimeFilesystemBinding[],
): string {
  return stableGeneration(bindings
    .map((binding) => ({ filesystem: binding.filesystem, access: binding.access }))
    .sort((left, right) => compareStrings(left.filesystem, right.filesystem)))
}

function scalarDecision(
  binding: RuntimeFilesystemBinding,
  path: string,
): RuntimeFilesystemAccessDecision {
  const writable = binding.access === 'readwrite'
  return {
    filesystem: binding.filesystem,
    normalizedPath: path,
    access: binding.access,
    capabilities: {
      read: true,
      write: writable,
      'create-child': writable,
      delete: writable,
      'move-from': writable,
    },
  }
}

async function bindingDecision(
  binding: RuntimeFilesystemBinding,
  descriptor: { filesystem: string; path: string },
): Promise<RuntimeFilesystemAccessDecision> {
  return binding.operations.resolveAccess?.(descriptor) ?? scalarDecision(binding, descriptor.path)
}

function mergePrimaryBindings(
  host: RuntimeFilesystemBinding,
  governance: RuntimeFilesystemBinding,
): RuntimeFilesystemBinding {
  const hostOperations = host.operations
  const operations: RuntimeFilesystemBinding['operations'] = {
    read: (descriptor) => hostOperations.read(descriptor),
    list: (descriptor) => hostOperations.list(descriptor),
    find: (descriptor, pattern, options) => hostOperations.find(descriptor, pattern, options),
    grep: (descriptor, pattern, options) => hostOperations.grep(descriptor, pattern, options),
    stat: (descriptor) => hostOperations.stat(descriptor),
    rejectMutation: (operation, descriptor) => hostOperations.rejectMutation(operation, descriptor),
    ...(hostOperations.write ? { write: (descriptor) => hostOperations.write!(descriptor) } : {}),
    ...(hostOperations.writeBinary ? { writeBinary: (descriptor) => hostOperations.writeBinary!(descriptor) } : {}),
    ...(hostOperations.delete ? { delete: (descriptor) => hostOperations.delete!(descriptor) } : {}),
    ...(hostOperations.move ? { move: (descriptor) => hostOperations.move!(descriptor) } : {}),
    ...(hostOperations.mkdir ? { mkdir: (descriptor) => hostOperations.mkdir!(descriptor) } : {}),
    async resolveAccess(descriptor) {
      const [hostDecision, governanceDecision] = await Promise.all([
        bindingDecision(host, descriptor),
        bindingDecision(governance, descriptor),
      ])
      const capabilities = Object.fromEntries(RUNTIME_FILESYSTEM_CAPABILITIES.map((capability) => [
        capability,
        hostDecision.capabilities[capability] && governanceDecision.capabilities[capability],
      ])) as Record<RuntimeFilesystemCapability, boolean>
      return Object.freeze({
        filesystem: host.filesystem,
        normalizedPath: hostDecision.normalizedPath,
        access: capabilities.write ? 'readwrite' as const : 'readonly' as const,
        capabilities: Object.freeze(capabilities),
      })
    },
  }
  return Object.freeze({
    filesystem: host.filesystem,
    access: host.access === 'readonly' || governance.access === 'readonly' ? 'readonly' : 'readwrite',
    operations,
  })
}

/**
 * Canonical final composition. Every owner is validated independently and all
 * outputs are validated together. The sole allowed duplicate is the explicit
 * host/governance `user` pair, which is consumed into one intersected binding.
 */
export function composeRuntimeFilesystemBindings(
  sources: readonly RuntimeFilesystemBindingSource[],
): RuntimeFilesystemBindingSnapshot {
  const ownerKeys = new Set<string>()
  for (const source of sources) {
    if (!source.owner || !source.generation || ownerKeys.has(`${source.role}:${source.owner}`)) {
      throw new RuntimeFilesystemBindingSourceError()
    }
    ownerKeys.add(`${source.role}:${source.owner}`)
    assertUniqueRuntimeFilesystemBindings(source.bindings)
  }

  const entries = sources.flatMap((source) => source.bindings.map((binding) => ({ source, binding })))
  const byFilesystem = new Map<string, typeof entries>()
  for (const entry of entries) {
    const cohort = byFilesystem.get(entry.binding.filesystem) ?? []
    cohort.push(entry)
    byFilesystem.set(entry.binding.filesystem, cohort)
  }

  const output: RuntimeFilesystemBinding[] = []
  for (const [filesystem, cohort] of byFilesystem) {
    if (cohort.length === 1) {
      output.push(cohort[0]!.binding)
      continue
    }
    const host = cohort.filter((entry) => entry.source.role === 'host')
    const governance = cohort.filter((entry) => entry.source.role === 'governance')
    if (filesystem === 'user' && cohort.length === 2 && host.length === 1 && governance.length === 1) {
      output.push(mergePrimaryBindings(host[0]!.binding, governance[0]!.binding))
      continue
    }
    throw new RuntimeFilesystemBindingConfigurationError(filesystem)
  }

  output.sort((left, right) => compareStrings(left.filesystem, right.filesystem))
  assertUniqueRuntimeFilesystemBindings(output)
  const identityInputs = sources.map((source) => ({
    owner: source.owner,
    generation: source.generation,
    role: source.role,
    bindings: source.bindings
      .map((binding) => ({ filesystem: binding.filesystem, access: binding.access }))
      .sort((left, right) => compareStrings(left.filesystem, right.filesystem)),
  })).sort((left, right) => (
    compareStrings(left.role, right.role)
      || compareStrings(left.owner, right.owner)
      || compareStrings(left.generation, right.generation)
  ))
  return Object.freeze({
    generation: stableGeneration(identityInputs),
    bindings: Object.freeze(output),
  })
}

/** Final request-scoped call seam shared by Workspace composition and tools. */
export function composeRuntimeAndGovernanceFilesystemBindings(
  hostBindings: readonly RuntimeFilesystemBinding[] | undefined,
  governanceBindings: readonly RuntimeFilesystemBinding[] | undefined,
): RuntimeFilesystemBindingSnapshot {
  const host = hostBindings ?? []
  return composeRuntimeFilesystemBindings([
    {
      owner: 'runtime',
      generation: createRuntimeFilesystemBindingsGeneration(host),
      role: 'host',
      bindings: host,
    },
    ...(governanceBindings
      ? [{
          owner: 'request-governance',
          generation: createRuntimeFilesystemBindingsGeneration(governanceBindings),
          role: 'governance' as const,
          bindings: governanceBindings,
        }]
      : []),
  ])
}
