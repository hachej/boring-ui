import { describe, expect, test } from 'vitest'

import type { RuntimeFilesystemBinding } from '../mode'
import {
  RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
  RuntimeFilesystemBindingConfigurationError,
  assertUniqueRuntimeFilesystemBindings,
  composeRuntimeAndGovernanceFilesystemBindings,
  composeRuntimeFilesystemBindings,
  type RuntimeFilesystemBindingSource,
} from '../filesystemBindings'

const operations = {
  read: async () => ({ content: '' }),
  list: async () => ({ entries: [] }),
  find: async () => ({ paths: [] }),
  grep: async () => ({ matches: [] }),
  stat: async () => ({ isDirectory: false }),
  rejectMutation: () => { throw new Error('readonly') },
} satisfies RuntimeFilesystemBinding['operations']

function binding(
  filesystem: string,
  access: RuntimeFilesystemBinding['access'] = 'readonly',
  customOperations: RuntimeFilesystemBinding['operations'] = operations,
): RuntimeFilesystemBinding {
  return { filesystem, access, operations: customOperations }
}

function source(
  owner: string,
  generation: string,
  role: RuntimeFilesystemBindingSource['role'],
  bindings: readonly RuntimeFilesystemBinding[],
): RuntimeFilesystemBindingSource {
  return { owner, generation, role, bindings }
}

describe('assertUniqueRuntimeFilesystemBindings', () => {
  test('preserves a unique final binding list by identity', () => {
    const bindings = [binding('user'), binding('agent_resources')]
    expect(assertUniqueRuntimeFilesystemBindings(bindings)).toBe(bindings)
  })


  test('rejects duplicate identities regardless of access or position', () => {
    const duplicate = binding('agent_resources', 'readwrite')
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

describe('composeRuntimeFilesystemBindings', () => {
  test('emits canonical filesystem ordering with order-independent generation', () => {
    const builtIns = source('built-ins', 'built-ins-v1', 'host', [
      binding('user', 'readwrite'),
      binding('zeta'),
    ])
    const resources = source('package-resources', 'resources-v3', 'supplemental', [
      binding('agent_resources'),
      binding('alpha'),
    ])

    const first = composeRuntimeFilesystemBindings([builtIns, resources])
    const second = composeRuntimeFilesystemBindings([
      { ...resources, bindings: [...resources.bindings].reverse() },
      { ...builtIns, bindings: [...builtIns.bindings].reverse() },
    ])

    expect(first.bindings.map((entry) => entry.filesystem)).toEqual([
      'agent_resources',
      'alpha',
      'user',
      'zeta',
    ])
    expect(second.bindings.map((entry) => entry.filesystem)).toEqual(
      first.bindings.map((entry) => entry.filesystem),
    )
    expect(second.generation).toBe(first.generation)
    expect(composeRuntimeFilesystemBindings([
      { ...builtIns, generation: 'built-ins-v2' },
      resources,
    ]).generation).not.toBe(first.generation)
  })

  test.each([
    ['built-ins and package resources', [
      source('built-ins', 'v1', 'host', [binding('agent_resources')]),
      source('package-resources', 'v1', 'supplemental', [binding('agent_resources')]),
    ]],
    ['built-ins and readonly declarations', [
      source('built-ins', 'v1', 'host', [binding('user')]),
      source('readonly-declarations', 'v1', 'supplemental', [binding('user')]),
    ]],
    ['package resources and readonly declarations', [
      source('package-resources', 'v1', 'supplemental', [binding('company_context')]),
      source('readonly-declarations', 'v1', 'host', [binding('company_context')]),
    ]],
  ] satisfies readonly [string, readonly RuntimeFilesystemBindingSource[]][])(
    'rejects reserved identifier collisions across %s',
    (_name, sources) => {
      expect(() => composeRuntimeFilesystemBindings(sources)).toThrowError(
        RuntimeFilesystemBindingConfigurationError,
      )
    },
  )

  test('consumes exactly one host/governance user pair and intersects every capability', async () => {
    const hostOperations: RuntimeFilesystemBinding['operations'] = {
      ...operations,
      resolveAccess: async ({ filesystem, path }) => ({
        filesystem,
        normalizedPath: path,
        access: 'readonly',
        capabilities: {
          read: true,
          write: false,
          'create-child': false,
          delete: false,
          'move-from': false,
        },
      }),
    }
    const governanceOperations: RuntimeFilesystemBinding['operations'] = {
      ...operations,
      resolveAccess: async ({ filesystem, path }) => ({
        filesystem,
        normalizedPath: path,
        access: 'readwrite',
        capabilities: {
          read: true,
          write: true,
          'create-child': true,
          delete: true,
          'move-from': true,
        },
      }),
    }

    const composed = composeRuntimeAndGovernanceFilesystemBindings(
      [binding('user', 'readwrite', hostOperations), binding('agent_resources')],
      [binding('user', 'readwrite', governanceOperations), binding('company_context')],
    )
    expect(composed.bindings.map((entry) => entry.filesystem)).toEqual([
      'agent_resources',
      'company_context',
      'user',
    ])
    const user = composed.bindings[2]!
    expect(user.operations).not.toBe(governanceOperations)
    await expect(user.operations.resolveAccess?.({ filesystem: 'user', path: '.agents' }))
      .resolves.toMatchObject({
        filesystem: 'user',
        normalizedPath: '.agents',
        access: 'readonly',
        capabilities: { write: false, delete: false },
      })
  })

  test('binding-wide governance readonly cannot be widened by a host readwrite summary', async () => {
    const [user] = composeRuntimeAndGovernanceFilesystemBindings(
      [binding('user', 'readwrite')],
      [binding('user', 'readonly')],
    ).bindings
    expect(user).toMatchObject({ filesystem: 'user', access: 'readonly' })
    await expect(user!.operations.resolveAccess?.({ filesystem: 'user', path: 'ordinary.txt' }))
      .resolves.toMatchObject({
        access: 'readonly',
        capabilities: {
          read: true,
          write: false,
          'create-child': false,
          delete: false,
          'move-from': false,
        },
      })
  })

  test('preserves prototype operations by binding explicit host delegates', async () => {
    class ProviderOperations {
      read = async () => ({ content: 'provider' })
      async list() { return { entries: [] } }
      async find() { return { paths: [] } }
      async grep() { return { matches: [] } }
      async stat() { return { isDirectory: false } }
      rejectMutation(): never { throw new Error('readonly') }
    }
    const provider = new ProviderOperations() as RuntimeFilesystemBinding['operations']
    const user = composeRuntimeAndGovernanceFilesystemBindings(
      [binding('user', 'readwrite', provider)],
      [binding('user', 'readwrite')],
    ).bindings[0]!

    await expect(user.operations.list({ filesystem: 'user', path: '' })).resolves.toEqual({ entries: [] })
    await expect(user.operations.read({ filesystem: 'user', path: 'file' })).resolves.toEqual({ content: 'provider' })
  })

  test('handles absent and empty governance and rejects a non-user collision', () => {
    const host = [binding('agent_resources')]
    expect(composeRuntimeAndGovernanceFilesystemBindings(host, undefined).bindings).toEqual(host)
    expect(composeRuntimeAndGovernanceFilesystemBindings(host, []).bindings).toEqual(host)
    expect(() => composeRuntimeAndGovernanceFilesystemBindings(host, [binding('agent_resources')]))
      .toThrowError(RuntimeFilesystemBindingConfigurationError)
  })
})
