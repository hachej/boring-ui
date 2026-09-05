import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdtemp, readdir, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { SandboxHandleRecord } from '@hachej/boring-agent/shared'
import { BlaxelFileHandleStore } from '../../blaxel/FileHandleStore'
import { FileHandleStore } from '../FileHandleStore'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const tempDirs: string[] = []
const children: ChildProcess[] = []

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
  vi.restoreAllMocks()
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        child.kill()
      })
    }
  }
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

test('concurrent puts preserve every record after reopening', async () => {
  const { store, storePath } = await makeStore()
  const records = ['a', 'b', 'c', 'd'].map((id) => makeRecord(id))

  await Promise.all(records.map((record) => store.put(record)))

  const reopened = new FileHandleStore({ storePath })
  expect((await reopened.list()).sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)))
    .toEqual(records)
})

test('puts and deletes from separate instances do not overwrite each other', async () => {
  const { store, storePath } = await makeStore()
  await store.put(makeRecord('remove-me'))
  await store.put(makeRecord('untouched'))
  const other = new FileHandleStore({ storePath })
  const blaxel = new BlaxelFileHandleStore(storePath)

  await Promise.all([
    store.delete('remove-me'),
    other.put(makeRecord('added')),
    blaxel.put(makeRecord('blaxel')),
    other.delete('missing'),
  ])

  const reopened = new FileHandleStore({ storePath })
  expect((await reopened.list()).map((record) => record.workspaceId).sort())
    .toEqual(['added', 'blaxel', 'untouched'])
})

test('parent directory aliases share the same mutation lock', async () => {
  const { store, storePath } = await makeStore()
  await store.put(makeRecord('existing'))
  const alias = path.join(path.dirname(path.dirname(storePath)), 'alias')
  await symlink(path.dirname(storePath), alias, 'dir')
  const aliased = new FileHandleStore({ storePath: path.join(alias, 'sandboxes.json') })

  await Promise.all([
    store.put(makeRecord('direct')),
    aliased.put(makeRecord('aliased')),
  ])

  expect((await store.list()).map((record) => record.workspaceId).sort())
    .toEqual(['aliased', 'direct', 'existing'])
})

function startWriter(storePath: string, prefix: string) {
  const source = new URL('../FileHandleStore.ts', import.meta.url).href
  const child = spawn(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e', `
      import { FileHandleStore } from ${JSON.stringify(source)}
      const store = new FileHandleStore({ storePath: process.argv[1] })
      const records = JSON.parse(process.argv[2])
      process.once('message', async () => {
        try {
          await Promise.all([
            ...records.map((record) => store.put(record)),
            store.delete(records[0].workspaceId + '-remove'),
          ])
        } catch (error) {
          console.error(error)
          process.exitCode = 1
        } finally {
          process.disconnect()
        }
      })
      process.send('ready')
    `,
    storePath,
    JSON.stringify(Array.from({ length: 4 }, (_, index) => makeRecord(`${prefix}-${index}`))),
  ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  children.push(child)
  let stderr = ''
  child.stderr!.on('data', (data) => { stderr += String(data) })
  const ready = new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve())
    child.once('error', reject)
    child.once('exit', () => reject(new Error(`Writer exited before starting: ${stderr}`)))
  })
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Writer exited with ${code}: ${stderr}`))
    })
  })
  // Observe early exits while the other writers are still becoming ready.
  void done.catch(() => {})
  return { child, ready, done }
}

test('independent processes preserve overlapping puts and deletes', async () => {
  const { store, storePath } = await makeStore()
  for (const prefix of ['one', 'two', 'three']) {
    await store.put(makeRecord(`${prefix}-0-remove`))
  }
  const writers = ['one', 'two', 'three'].map((prefix) => startWriter(storePath, prefix))
  await Promise.all(writers.map((writer) => writer.ready))
  for (const writer of writers) writer.child.send('go')
  await Promise.all(writers.map((writer) => writer.done))

  const reopened = new FileHandleStore({ storePath })
  const expected = ['one', 'two', 'three'].flatMap((prefix) =>
    Array.from({ length: 4 }, (_, index) => `${prefix}-${index}`))
  expect((await reopened.list()).map((record) => record.workspaceId).sort())
    .toEqual(expected.sort())
}, 15_000)

test('a failed rename preserves committed data and releases the lock for retry', async () => {
  const { store, storePath } = await makeStore()
  const committed = makeRecord('stable')
  await store.put(committed)

  const { rename } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(fs.rename).mockImplementationOnce(async (source) => {
    // Exercise an actual failing rename syscall: a regular file cannot be a parent.
    await rename(source, path.join(storePath, 'invalid-destination'))
  })
  await expect(store.put(makeRecord('retry-me'))).rejects.toMatchObject({ code: 'ENOTDIR' })

  await expect(store.get('stable')).resolves.toEqual(committed)
  expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual({ stable: committed })
  expect(await readdir(path.dirname(storePath))).toEqual(['sandboxes.json'])

  await new FileHandleStore({ storePath }).put(makeRecord('retry-me'))
  expect((await store.list()).map((record) => record.workspaceId).sort())
    .toEqual(['retry-me', 'stable'])
})
