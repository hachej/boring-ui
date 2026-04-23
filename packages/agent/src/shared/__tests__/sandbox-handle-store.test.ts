import { expectTypeOf, test } from 'vitest'

import type { SandboxHandleRecord, SandboxHandleStore } from '../sandbox-handle-store'

test('SandboxHandleRecord contract', () => {
  expectTypeOf<SandboxHandleRecord>().toEqualTypeOf<{
    workspaceId: string
    sandboxId: string
    snapshotId?: string
    createdAt: string
    lastUsedAt: string
  }>()
})

test('SandboxHandleStore contract', () => {
  expectTypeOf<SandboxHandleStore>().toHaveProperty('get')
  expectTypeOf<SandboxHandleStore>().toHaveProperty('put')
  expectTypeOf<SandboxHandleStore>().toHaveProperty('delete')
  expectTypeOf<SandboxHandleStore>().toHaveProperty('list')

  expectTypeOf<SandboxHandleStore['get']>().parameters.toEqualTypeOf<[workspaceId: string]>()
  expectTypeOf<SandboxHandleStore['get']>().returns.toEqualTypeOf<
    Promise<SandboxHandleRecord | null>
  >()
  expectTypeOf<SandboxHandleStore['put']>().parameters.toEqualTypeOf<[record: SandboxHandleRecord]>()
  expectTypeOf<SandboxHandleStore['put']>().returns.toEqualTypeOf<Promise<void>>()
  expectTypeOf<SandboxHandleStore['delete']>().parameters.toEqualTypeOf<[workspaceId: string]>()
  expectTypeOf<SandboxHandleStore['delete']>().returns.toEqualTypeOf<Promise<void>>()
  expectTypeOf<SandboxHandleStore['list']>().returns.toEqualTypeOf<Promise<SandboxHandleRecord[]>>()
})
