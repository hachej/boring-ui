import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { SandboxHandleRecord } from '@hachej/boring-agent/shared'
import { FileHandleStore } from '../FileHandleStore'

const tempDirs: string[] = []

function makeRecord(
  workspaceId: string,
  overrides: Partial<SandboxHandleRecord> = {},
): SandboxHandleRecord {
  return {
    workspaceId,
    sandboxId: `${workspaceId}-sandbox`,
    snapshotId: `${workspaceId}-snapshot`,
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
    ...overrides,
  }
}

async function makeStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'boring-ui-file-handle-store-'))
  tempDirs.push(root)
  const storePath = path.join(root, 'config', 'sandboxes.json')
  return {
    storePath,
    store: new FileHandleStore({ storePath }),
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

test('put + get roundtrip', async () => {
  const { store } = await makeStore()
  const record = makeRecord('ws-1')

  await store.put(record)
  await expect(store.get('ws-1')).resolves.toEqual(record)
})

test('fresh store reads as empty', async () => {
  const { store } = await makeStore()

  await expect(store.get('missing')).resolves.toBeNull()
  await expect(store.list()).resolves.toEqual([])
})

test('list returns all records', async () => {
  const { store } = await makeStore()
  const a = makeRecord('a')
  const b = makeRecord('b')

  await store.put(a)
  await store.put(b)

  const listed = await store.list()
  const ids = listed.map((entry) => entry.workspaceId).sort()
  expect(ids).toEqual(['a', 'b'])
})

test('delete removes records', async () => {
  const { store } = await makeStore()
  const record = makeRecord('delete-me')

  await store.put(record)
  await store.delete('delete-me')

  await expect(store.get('delete-me')).resolves.toBeNull()
  await expect(store.list()).resolves.toEqual([])
})

test('writes store file with 0600 mode', async () => {
  const { store, storePath } = await makeStore()
  await store.put(makeRecord('ws-mode'))

  const storeStat = await stat(storePath)
  expect(storeStat.mode & 0o777).toBe(0o600)
})

test('partial tmp write does not corrupt committed store content', async () => {
  const { store, storePath } = await makeStore()
  const committed = makeRecord('stable')
  await store.put(committed)

  const tmpPath = `${storePath}.tmp-crash`
  await writeFile(tmpPath, '{"stable":', 'utf8')

  await expect(store.get('stable')).resolves.toEqual(committed)

  const persistedRaw = await readFile(storePath, 'utf8')
  const persisted = JSON.parse(persistedRaw) as Record<string, SandboxHandleRecord>
  expect(persisted.stable).toEqual(committed)
})
