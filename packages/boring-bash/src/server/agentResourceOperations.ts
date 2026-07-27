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
    const projection = createReadonlyMultiRootProjectionOperations({
      filesystem,
      mounts,
      pathStyle: 'relative',
      symlinks: 'confined',
    })
    const operations: RuntimeFilesystemBinding['operations'] = {
      async read(descriptor) {
        const { content, mtimeMs } = await projection.read(descriptor)
        return { content, ...(mtimeMs === undefined ? {} : { mtimeMs }) }
      },
      async list(descriptor) {
        const { entries } = await projection.list(descriptor)
        return { entries }
      },
      async find(descriptor, pattern, options) {
        const { paths } = await projection.find(descriptor, pattern, options)
        return { paths }
      },
      async grep(descriptor, pattern, options) {
        const { matches } = await projection.grep(descriptor, pattern, options)
        return { matches }
      },
      async stat(descriptor) {
        const { isDirectory } = await projection.stat(descriptor)
        return { isDirectory }
      },
      rejectMutation: projection.rejectMutation,
    }
    return { filesystem, access: 'readonly', operations }
  } catch (error) {
    if (error instanceof ReadonlyProjectionOperationError) throw error
    throw invalidMount(filesystem)
  }
}
