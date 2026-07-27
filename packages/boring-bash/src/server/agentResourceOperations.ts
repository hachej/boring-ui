import { lstat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { RuntimeFilesystemBinding } from '@hachej/boring-agent/server'

import {
  READONLY_PROJECTION_INVALID_PATH_CODE,
  ReadonlyProjectionOperationError,
  createReadonlyMultiRootProjectionOperations,
  type ReadonlyProjectionMount,
} from './readonlyProjectionOperations'

export interface ReadonlyMultiRootMount {
  readonly logicalRoot: string
  readonly sourceRoot: string
}

function invalidMount(filesystem: string): ReadonlyProjectionOperationError {
  return new ReadonlyProjectionOperationError(
    READONLY_PROJECTION_INVALID_PATH_CODE,
    'readonly resource path is not found or denied',
    { filesystem, path: 'not_found_or_denied', operation: 'mount' },
  )
}

/** Build one confined readonly binding from explicitly admitted roots. */
export async function createAgentResourceFilesystemBinding(
  filesystem: string,
  inputMounts: readonly ReadonlyMultiRootMount[],
): Promise<RuntimeFilesystemBinding> {
  if (!filesystem) throw invalidMount('unknown')
  try {
    const mounts: ReadonlyProjectionMount[] = []
    for (const mount of inputMounts) {
      const sourceRoot = await realpath(resolve(mount.sourceRoot))
      if (!(await lstat(sourceRoot)).isDirectory()) throw new Error('mount is not a directory')
      mounts.push({ logicalRoot: mount.logicalRoot.replace(/\/$/, ''), sourceRoot })
    }
    const operations: RuntimeFilesystemBinding['operations'] = createReadonlyMultiRootProjectionOperations({
      filesystem,
      mounts,
      pathStyle: 'relative',
      symlinks: 'confined',
    })
    return { filesystem, access: 'readonly', operations }
  } catch (error) {
    if (error instanceof ReadonlyProjectionOperationError) throw error
    throw invalidMount(filesystem)
  }
}
