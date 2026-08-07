import { describe, expect, test } from 'vitest'

import type { RuntimeFilesystemBinding } from '../mode'
import {
  RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
  RuntimeFilesystemBindingConfigurationError,
  mergeRuntimeFilesystemBindings,
} from '../filesystemBindings'

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

describe('mergeRuntimeFilesystemBindings', () => {
  test('merges runtime and request owners before one final uniqueness check', () => {
    expect(mergeRuntimeFilesystemBindings(
      [binding('company_context')],
      [binding('agent_resources')],
    )?.map((entry) => entry.filesystem)).toEqual(['company_context', 'agent_resources'])
    expect(mergeRuntimeFilesystemBindings(undefined, undefined)).toBeUndefined()
    expect(() => mergeRuntimeFilesystemBindings(
      [binding('agent_resources')],
      [binding('agent_resources')],
    )).toThrowError(RuntimeFilesystemBindingConfigurationError)
  })

  test('returns a stable redacted duplicate error', () => {
    try {
      mergeRuntimeFilesystemBindings(
        [binding('agent_resources')],
        [{ ...binding('agent_resources'), access: 'readwrite' }],
      )
      throw new Error('expected duplicate rejection')
    } catch (error) {
      expect(error).toMatchObject({
        code: RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
        filesystem: 'agent_resources',
      })
      expect(String(error)).not.toContain('/home/')
    }
  })
})
