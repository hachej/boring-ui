import type {
  RuntimeFilesystemAccessDecision,
  RuntimeFilesystemBinding,
  RuntimeFilesystemCapability,
} from '../../agent/runtime/types'

function scalarDecision(binding: RuntimeFilesystemBinding, path: string): RuntimeFilesystemAccessDecision {
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

export async function resolveBindingAccess(
  binding: RuntimeFilesystemBinding,
  path: string,
): Promise<RuntimeFilesystemAccessDecision> {
  try {
    return await binding.operations.resolveAccess?.({ filesystem: binding.filesystem, path })
      ?? scalarDecision(binding, path)
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID') {
      throw Object.assign(new Error('path traversal rejected'), { code: 'EPERM', statusCode: 403 })
    }
    throw error
  }
}

export async function requireBindingCapability(
  binding: RuntimeFilesystemBinding,
  path: string,
  capability: RuntimeFilesystemCapability,
): Promise<RuntimeFilesystemAccessDecision> {
  const decision = await resolveBindingAccess(binding, path)
  if (!decision.capabilities[capability]) {
    if (!binding.operations.resolveAccess && binding.access === 'readonly') {
      throw Object.assign(new Error(`${binding.filesystem} binding is readonly`), {
        code: 'readonly',
        statusCode: 403,
        filesystem: binding.filesystem,
        operation: capability,
      })
    }
    binding.operations.rejectMutation(capability, { filesystem: binding.filesystem, path })
  }
  return decision
}

export function accessProjection(decision: RuntimeFilesystemAccessDecision) {
  return { access: decision.access, capabilities: decision.capabilities }
}
