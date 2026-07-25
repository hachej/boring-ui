import { describe, expect, test } from 'vitest'

import type { RuntimeFilesystemBinding } from '../mode'
import {
  RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
  RuntimeFilesystemBindingConfigurationError,
  assertUniqueRuntimeFilesystemBindings,
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

describe('assertUniqueRuntimeFilesystemBindings', () => {
  test('preserves a unique final binding list by identity', () => {
    const bindings = [binding('user'), binding('agent_resources')]
    expect(assertUniqueRuntimeFilesystemBindings(bindings)).toBe(bindings)
  })

  test('rejects duplicate identities regardless of access or position', () => {
    const duplicate = { ...binding('agent_resources'), access: 'readwrite' as const }
    expect(() => assertUniqueRuntimeFilesystemBindings([
      binding('user'),
      binding('agent_resources'),
      binding('company_context'),
      duplicate,
    ])).toThrowError(RuntimeFilesystemBindingConfigurationError)

    try {
      assertUniqueRuntimeFilesystemBindings([binding('agent_resources'), duplicate])
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
