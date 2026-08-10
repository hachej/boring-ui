import { describe, expect, test, vi } from 'vitest'

import type { RuntimeFilesystemBinding } from '../mode'
import {
  RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
  RuntimeFilesystemBindingConfigurationError,
  mergeRuntimeFilesystemBindings,
} from '../filesystemBindings'
import { ReadonlyFilesystemMutationError } from '../../../shared/workspace'

const operations = {
  read: async () => ({ content: '' }),
  list: async () => ({ entries: [] }),
  find: async () => ({ paths: [] }),
  grep: async () => ({ matches: [] }),
  stat: async () => ({ isDirectory: false }),
  rejectMutation: () => { throw new Error('readonly') },
} satisfies RuntimeFilesystemBinding['operations']

function binding(filesystem: string): RuntimeFilesystemBinding {
  return { filesystem, access: 'readonly', operations }
}

function capabilities(write: boolean): Record<string, boolean> {
  return { read: true, write, 'create-child': write, delete: write, 'move-from': write }
}

describe('mergeRuntimeFilesystemBindings', () => {
  test('merges runtime and request owners', () => {
    expect(mergeRuntimeFilesystemBindings(
      [binding('company_context')],
      [binding('agent_resources')],
    )?.map((entry) => entry.filesystem)).toEqual(['company_context', 'agent_resources'])
    expect(mergeRuntimeFilesystemBindings(undefined, undefined)).toBeUndefined()
  })

  test('rejects duplicates within a single owner list', () => {
    expect(() => mergeRuntimeFilesystemBindings(
      [binding('agent_resources'), binding('agent_resources')],
      undefined,
    )).toThrowError(RuntimeFilesystemBindingConfigurationError)
    try {
      mergeRuntimeFilesystemBindings(undefined, [binding('agent_resources'), binding('agent_resources')])
      throw new Error('expected duplicate rejection')
    } catch (error) {
      expect(error).toMatchObject({
        code: RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
        filesystem: 'agent_resources',
      })
      expect(String(error)).not.toContain('/home/')
    }
  })

  test('composes a host binding with a request-scoped binding of the same id', async () => {
    const requestWrite = vi.fn(async () => ({ mtimeMs: 1 }))
    const host: RuntimeFilesystemBinding = {
      filesystem: 'user',
      access: 'readwrite',
      operations: {
        ...operations,
        resolveAccess: async ({ path }) => ({
          filesystem: 'user',
          normalizedPath: path,
          access: path.startsWith('.agents') ? 'readonly' : 'readwrite',
          capabilities: capabilities(!path.startsWith('.agents')) as never,
        }),
        rejectMutation: (operation) => {
          throw new ReadonlyFilesystemMutationError('user', operation as never)
        },
      },
    }
    const request: RuntimeFilesystemBinding = {
      filesystem: 'user',
      access: 'readwrite',
      operations: { ...operations, write: requestWrite },
    }

    const merged = mergeRuntimeFilesystemBindings([host], [request])
    expect(merged).toHaveLength(1)
    const composed = merged![0]!

    // Host policy narrows the request binding instead of throwing a duplicate error.
    await expect(composed.operations.write?.({ filesystem: 'user', path: '.agents/skills/x.md', content: 'no' }))
      .rejects.toBeInstanceOf(ReadonlyFilesystemMutationError)
    expect(requestWrite).not.toHaveBeenCalled()

    await expect(composed.operations.write?.({ filesystem: 'user', path: 'src/ok.ts', content: 'yes' }))
      .resolves.toMatchObject({ mtimeMs: 1 })
    expect(requestWrite).toHaveBeenCalledTimes(1)
  })

  test('composed access is readonly when either side is readonly', () => {
    const merged = mergeRuntimeFilesystemBindings(
      [{ ...binding('user'), access: 'readonly' }],
      [{ ...binding('user'), access: 'readwrite' }],
    )
    expect(merged?.[0]?.access).toBe('readonly')
  })
})
