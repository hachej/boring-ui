import { lstat, mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CompanyContextConflictError, CompanyContextStore } from '../companyContextStore.js'

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'boring-company-store-'))
  await mkdir(path.join(root, 'public'))
  await writeFile(path.join(root, 'public', 'handbook.md'), 'v1', 'utf8')
  return { root, store: await CompanyContextStore.open(root) }
}

async function runContendingWriter(root: string, expectedMtimeMs: number, content: string): Promise<number | null> {
  const moduleUrl = new URL('../companyContextStore.ts', import.meta.url).href
  const script = `
    const { CompanyContextStore } = await import(${JSON.stringify(moduleUrl)})
    const store = await CompanyContextStore.open(process.env.COMPANY_ROOT)
    try {
      await store.write('/public/handbook.md', process.env.COMPANY_CONTENT, Number(process.env.COMPANY_MTIME))
      process.exit(0)
    } catch (error) {
      process.exit(error?.code === 'conflict' ? 2 : 3)
    }
  `
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    env: {
      ...process.env,
      COMPANY_ROOT: root,
      COMPANY_CONTENT: content,
      COMPANY_MTIME: String(expectedMtimeMs),
    },
    stdio: 'ignore',
  })
  return await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
}

describe('CompanyContextStore', () => {
  it('atomically writes and rejects stale versions', async () => {
    const { root, store } = await createStore()
    const initial = await store.read('/public/handbook.md')
    const updated = await store.write('/public/handbook.md', 'v2', initial.mtimeMs)
    expect(updated.mtimeMs).toEqual(expect.any(Number))
    expect(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8')).toBe('v2')

    await expect(store.write('/public/handbook.md', 'stale', initial.mtimeMs))
      .rejects.toBeInstanceOf(CompanyContextConflictError)
    expect(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8')).toBe('v2')
    expect((await lstat(path.join(root, 'public'))).isDirectory()).toBe(true)
  })

  it('recovers a lock left by a terminated process in the same runtime host', async () => {
    const { root, store } = await createStore()
    const lockRoot = path.join(root, '.boring-governance', 'mutation.lock')
    await mkdir(lockRoot, { recursive: true })
    const stale = new Date(Date.now() - 60_000)
    await utimes(lockRoot, stale, stale)

    await expect(store.write('/public/handbook.md', 'recovered')).resolves.toMatchObject({ mtimeMs: expect.any(Number) })
    expect(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8')).toBe('recovered')
  })

  it('serializes stale-lock recovery and conditional writes across processes', async () => {
    const { root, store } = await createStore()
    const initial = await store.read('/public/handbook.md')
    const lockRoot = path.join(root, '.boring-governance', 'mutation.lock')
    await mkdir(lockRoot, { recursive: true })
    const stale = new Date(Date.now() - 60_000)
    await utimes(lockRoot, stale, stale)

    const exitCodes = await Promise.all([
      runContendingWriter(root, initial.mtimeMs, 'child-one'),
      runContendingWriter(root, initial.mtimeMs, 'child-two'),
    ])
    expect(exitCodes.sort()).toEqual([0, 2])
    expect(['child-one', 'child-two']).toContain(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8'))
  })

  it('serializes conditional writes across store instances', async () => {
    const { root, store } = await createStore()
    const secondStore = await CompanyContextStore.open(root)
    const initial = await store.read('/public/handbook.md')
    const results = await Promise.allSettled([
      store.write('/public/handbook.md', 'first', initial.mtimeMs),
      secondStore.write('/public/handbook.md', 'second', initial.mtimeMs),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(['first', 'second']).toContain(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8'))
  })

  it('treats a missing expected file as a conflict', async () => {
    const { store } = await createStore()
    await expect(store.write('/public/missing.md', 'new', 123))
      .rejects.toMatchObject({
        code: 'conflict',
        details: { currentMtimeMs: undefined, expectedMtimeMs: 123 },
      })
  })

  it('supports contained create, move, mkdir, and delete operations', async () => {
    const { root, store } = await createStore()
    await store.mkdir('/managed/nested', true)
    await store.write('/managed/nested/note.md', 'note')
    await store.move('/managed/nested/note.md', '/managed/note.md')
    expect((await store.read('/managed/note.md')).content).toBe('note')
    await store.delete('/managed/note.md')
    await expect(store.read('/managed/note.md')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8')).toBe('v1')
  })

  it('rejects a symlinked internal state directory', async () => {
    const { root, store } = await createStore()
    const outside = await mkdtemp(path.join(os.tmpdir(), 'boring-company-state-outside-'))
    await symlink(outside, path.join(root, '.boring-governance'))
    await expect(store.write('/public/handbook.md', 'bad')).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(path.join(root, 'public', 'handbook.md'), 'utf8')).toBe('v1')
    await expect(readFile(path.join(outside, 'mutation.lock', 'owner'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects traversal and symlink ancestors without mutating outside the root', async () => {
    const { root, store } = await createStore()
    const outside = await mkdtemp(path.join(os.tmpdir(), 'boring-company-outside-'))
    await symlink(outside, path.join(root, 'linked'))
    await symlink(path.join(outside, 'outside.md'), path.join(root, 'public', 'leaf-link.md'))

    await expect(store.write('../outside.md', 'bad')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(store.write('/team/.boring-governance/note.md', 'bad')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(store.write('/linked/outside.md', 'bad')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(store.write('/public/leaf-link.md', 'bad')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(store.delete('/public/leaf-link.md')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(store.move('/public/leaf-link.md', '/public/moved.md')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(readFile(path.join(outside, 'outside.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
