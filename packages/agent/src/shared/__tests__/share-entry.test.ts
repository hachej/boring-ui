import { describe, expect, it } from 'vitest'

import {
  InMemoryShareEntryStore,
  OpaqueShareLocatorIdSchema,
  ShareEntryErrorCode,
  ShareEntryV1Schema,
  ShareEntryValidationError,
  resolveShareEntry,
  type CreateShareEntryInput,
  type ShareEntryV1,
} from '../share-entry'
import type { Stat, Workspace } from '../workspace'

function validInput(overrides: Partial<CreateShareEntryInput> = {}): CreateShareEntryInput {
  return {
    workspaceId: 'workspace-1',
    path: 'reports/q1.md',
    provenance: { producerPrincipalRef: 'agent-a' },
    ...overrides,
  }
}

/** Minimal fake satisfying the `Workspace` contract for `stat`-only tests. */
function fakeWorkspace(opts: { existingPaths: Set<string> }): Workspace {
  return {
    root: '/workspace',
    runtimeContext: { runtimeCwd: '/workspace' },
    async readFile() {
      throw new Error('not implemented')
    },
    async writeFile() {
      throw new Error('not implemented')
    },
    async unlink() {
      throw new Error('not implemented')
    },
    async readdir() {
      return []
    },
    async stat(relPath: string): Promise<Stat> {
      if (!opts.existingPaths.has(relPath)) {
        throw new Error(`PATH_NOT_FOUND: ${relPath}`)
      }
      return { size: 0, mtimeMs: Date.now(), kind: 'file' }
    },
    async mkdir() {
      throw new Error('not implemented')
    },
    async rename() {
      throw new Error('not implemented')
    },
  }
}

describe('ShareEntryV1Schema', () => {
  it('accepts a well-formed entry', () => {
    const entry: ShareEntryV1 = {
      schemaVersion: 1,
      id: 'share-1',
      workspaceId: 'workspace-1',
      path: 'reports/q1.md',
      provenance: { producerPrincipalRef: 'agent-a', createdAt: '2026-07-13T00:00:00.000Z' },
    }
    expect(ShareEntryV1Schema.safeParse(entry).success).toBe(true)
  })

  it('rejects unknown fields (schema version 1 is closed)', () => {
    const entry = {
      schemaVersion: 1,
      id: 'share-1',
      workspaceId: 'workspace-1',
      path: 'reports/q1.md',
      provenance: { producerPrincipalRef: 'agent-a', createdAt: '2026-07-13T00:00:00.000Z' },
      extra: 'nope',
    }
    expect(ShareEntryV1Schema.safeParse(entry).success).toBe(false)
  })
})

describe('OpaqueShareLocatorIdSchema (opacity precedent, AC1-T2)', () => {
  it.each([
    'share-1',
    'a1b2c3',
    crypto.randomUUID(),
  ])('accepts an opaque id: %s', (value) => {
    expect(OpaqueShareLocatorIdSchema.safeParse(value).success).toBe(true)
  })

  it.each([
    ['/etc/passwd', 'absolute path'],
    ['../secret', 'path traversal'],
    ['workspace/relative', 'workspace-relative path'],
    ['file:///etc/passwd', 'file scheme'],
    ['https://evil.example/x', 'url scheme'],
    ['a\\b', 'backslash'],
    ['.', 'dot'],
    ['..', 'dot-dot'],
    ['', 'empty'],
    [' share-1', 'leading whitespace'],
  ])('rejects a non-opaque id: %s (%s)', (value) => {
    expect(OpaqueShareLocatorIdSchema.safeParse(value).success).toBe(false)
  })
})

describe('InMemoryShareEntryStore.create', () => {
  it('mints an opaque id and persists {id, workspaceId, path, provenance}', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create(validInput())

    expect(entry.schemaVersion).toBe(1)
    expect(OpaqueShareLocatorIdSchema.safeParse(entry.id).success).toBe(true)
    expect(entry.workspaceId).toBe('workspace-1')
    expect(entry.path).toBe('reports/q1.md')
    expect(entry.provenance.producerPrincipalRef).toBe('agent-a')
    expect(typeof entry.provenance.createdAt).toBe('string')

    const parsed = ShareEntryV1Schema.safeParse(entry)
    expect(parsed.success).toBe(true)
  })

  it('mints a distinct id per creation, even for identical input', async () => {
    const store = new InMemoryShareEntryStore()
    const a = await store.create(validInput())
    const b = await store.create(validInput())
    expect(a.id).not.toBe(b.id)
  })

  it('honors an explicit provenance.createdAt instead of defaulting', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create(validInput({ provenance: { producerPrincipalRef: 'agent-a', createdAt: '2020-01-01T00:00:00.000Z' } }))
    expect(entry.provenance.createdAt).toBe('2020-01-01T00:00:00.000Z')
  })

  it.each([
    ['empty workspaceId', validInput({ workspaceId: '' })],
    ['path-shaped workspaceId', validInput({ workspaceId: '/etc/passwd' })],
    ['traversal workspaceId', validInput({ workspaceId: '../x' })],
    ['empty path', validInput({ path: '' })],
    ['empty producerPrincipalRef', validInput({ provenance: { producerPrincipalRef: '' } })],
  ])('rejects invalid create input: %s', async (_label, input) => {
    const store = new InMemoryShareEntryStore()
    await expect(store.create(input)).rejects.toBeInstanceOf(ShareEntryValidationError)
  })

  it('validation error carries a stable code and no path leak in the message', async () => {
    const store = new InMemoryShareEntryStore()
    try {
      await store.create(validInput({ workspaceId: '/etc/passwd' }))
      expect.unreachable('expected create() to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ShareEntryValidationError)
      const validationError = err as ShareEntryValidationError
      expect(validationError.code).toBe('CONFIG_INVALID')
      expect(validationError.field).toBe('workspaceId')
    }
  })
})

describe('InMemoryShareEntryStore CRUD', () => {
  it('get returns null for an unknown id', async () => {
    const store = new InMemoryShareEntryStore()
    expect(await store.get('does-not-exist')).toBeNull()
  })

  it('get returns the created entry by id', async () => {
    const store = new InMemoryShareEntryStore()
    const created = await store.create(validInput())
    const fetched = await store.get(created.id)
    expect(fetched).toEqual(created)
  })

  it('delete removes the entry (deleting the entry removes the link — spec §3.2)', async () => {
    const store = new InMemoryShareEntryStore()
    const created = await store.create(validInput())
    await store.delete(created.id)
    expect(await store.get(created.id)).toBeNull()
  })

  it('delete of an unknown id is a no-op', async () => {
    const store = new InMemoryShareEntryStore()
    await expect(store.delete('does-not-exist')).resolves.toBeUndefined()
  })

  it('list scopes to one workspace and never leaks entries from another', async () => {
    const store = new InMemoryShareEntryStore()
    const a = await store.create(validInput({ workspaceId: 'workspace-a' }))
    await store.create(validInput({ workspaceId: 'workspace-b' }))

    const listed = await store.list('workspace-a')
    expect(listed).toEqual([a])
  })
})

describe('resolveShareEntry (live-reference + tombstone, spec §3.2/§3.3)', () => {
  it('returns not_found for an unknown id, with no path field anywhere on the result', async () => {
    const store = new InMemoryShareEntryStore()
    const workspace = fakeWorkspace({ existingPaths: new Set() })

    const resolution = await resolveShareEntry(store, 'does-not-exist', workspace)

    expect(resolution.status).toBe('not_found')
    expect(resolution).toEqual({
      status: 'not_found',
      code: ShareEntryErrorCode.enum.AR1_SHARE_NOT_FOUND,
    })
    expect(JSON.stringify(resolution)).not.toContain('path')
  })

  it('returns ok with the live entry when the target file stats successfully', async () => {
    const store = new InMemoryShareEntryStore()
    const created = await store.create(validInput())
    const workspace = fakeWorkspace({ existingPaths: new Set([created.path]) })

    const resolution = await resolveShareEntry(store, created.id, workspace)

    expect(resolution).toEqual({ status: 'ok', entry: created })
  })

  it('returns tombstoned (never a bare 404) when the target file is gone, carrying provenance but never path', async () => {
    const store = new InMemoryShareEntryStore()
    const created = await store.create(validInput())
    const workspace = fakeWorkspace({ existingPaths: new Set() })

    const resolution = await resolveShareEntry(store, created.id, workspace)

    expect(resolution.status).toBe('tombstoned')
    if (resolution.status !== 'tombstoned') throw new Error('unreachable')
    expect(resolution.code).toBe('AR1_SHARE_TOMBSTONED')
    expect(resolution.tombstone).toEqual({
      id: created.id,
      workspaceId: created.workspaceId,
      provenance: created.provenance,
    })
    // Missing-file tombstone data path: last-known metadata renders, the
    // server-internal path never leaks into the tombstone projection.
    expect(Object.keys(resolution.tombstone)).not.toContain('path')
    expect(JSON.stringify(resolution.tombstone)).not.toContain(created.path)
  })

  it('is a live reference: a file that reappears resolves ok again (not pinned to the tombstone)', async () => {
    const store = new InMemoryShareEntryStore()
    const created = await store.create(validInput())
    const paths = new Set<string>()
    const workspace = fakeWorkspace({ existingPaths: paths })

    const gone = await resolveShareEntry(store, created.id, workspace)
    expect(gone.status).toBe('tombstoned')

    paths.add(created.path)
    const back = await resolveShareEntry(store, created.id, workspace)
    expect(back).toEqual({ status: 'ok', entry: created })
  })
})
