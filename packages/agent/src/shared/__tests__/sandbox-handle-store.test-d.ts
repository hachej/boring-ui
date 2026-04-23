import { expectTypeOf, test } from 'vitest'
import type { SandboxHandleStore, SandboxHandleRecord } from '../sandbox-handle-store'

test('checking SandboxHandleStore contract', () => {
  expectTypeOf<SandboxHandleStore>().toHaveProperty('get')
  expectTypeOf<SandboxHandleStore>().toHaveProperty('put')
  expectTypeOf<SandboxHandleStore>().toHaveProperty('delete')
  expectTypeOf<SandboxHandleStore>().toHaveProperty('list')

  expectTypeOf<SandboxHandleStore['get']>().toBeFunction()
  expectTypeOf<SandboxHandleStore['put']>().toBeFunction()
  expectTypeOf<SandboxHandleStore['delete']>().toBeFunction()
  expectTypeOf<SandboxHandleStore['list']>().toBeFunction()
})

test('checking SandboxHandleRecord contract', () => {
  expectTypeOf<SandboxHandleRecord>().toHaveProperty('workspaceId')
  expectTypeOf<SandboxHandleRecord>().toHaveProperty('sandboxId')
  expectTypeOf<SandboxHandleRecord>().toHaveProperty('snapshotId')
  expectTypeOf<SandboxHandleRecord>().toHaveProperty('createdAt')
  expectTypeOf<SandboxHandleRecord>().toHaveProperty('lastUsedAt')

  expectTypeOf<SandboxHandleRecord['workspaceId']>().toEqualTypeOf<string>()
  expectTypeOf<SandboxHandleRecord['sandboxId']>().toEqualTypeOf<string>()
  expectTypeOf<SandboxHandleRecord['createdAt']>().toEqualTypeOf<string>()
})
