import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { PATH_TRAVERSAL_CORPUS } from '../../../__tests__/fixtures/pathTraversalCorpus'
import { createNodeWorkspace } from '../createNodeWorkspace'
import type { PathRejectReason } from '../paths'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

const REASONS: PathRejectReason[] = [
  'path-escape',
  'absolute-path',
  'null-byte',
  'symlink-escape',
]

function getReason(error: unknown): PathRejectReason | null {
  const reason = (error as { reason?: string }).reason
  return REASONS.includes(reason as PathRejectReason) ? (reason as PathRejectReason) : null
}

async function setupWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'boring-ui-node-workspace-'))
  tempDirs.push(root)
  return { root, workspace: createNodeWorkspace(root) }
}

test('supports all 7 workspace methods on happy paths', async () => {
  const { workspace } = await setupWorkspace()

  await workspace.mkdir('src', { recursive: false })
  await workspace.mkdir('deep/nested', { recursive: true })
  await workspace.writeFile('src/hello.txt', 'hello')
  await workspace.writeFile('deep/nested/value.txt', 'v')
  expect(await workspace.readFile('src/hello.txt')).toBe('hello')
  expect(await workspace.readFile('deep/nested/value.txt')).toBe('v')

  const entries = await workspace.readdir('src')
  expect(entries).toEqual([{ name: 'hello.txt', kind: 'file' }])

  const stat = await workspace.stat('src/hello.txt')
  expect(stat.kind).toBe('file')
  expect(stat.size).toBe(5)

  await workspace.rename('src/hello.txt', 'src/renamed.txt')
  expect(await workspace.readFile('src/renamed.txt')).toBe('hello')

  await workspace.mkdir('dst', { recursive: false })
  await workspace.rename('src/renamed.txt', 'dst/moved.txt')
  expect(await workspace.readFile('dst/moved.txt')).toBe('hello')

  await workspace.unlink('dst/moved.txt')
  await expect(workspace.readFile('dst/moved.txt')).rejects.toThrow()
})

test('optimized read/write with stat helpers return content and metadata', async () => {
  const { workspace } = await setupWorkspace()

  await workspace.writeFileWithStat?.('optimized.txt', 'hello')
  const read = await workspace.readFileWithStat?.('optimized.txt')

  expect(read?.content).toBe('hello')
  expect(read?.stat.kind).toBe('file')
  expect(read?.stat.size).toBe(5)

  const writeStat = await workspace.writeFileWithStat?.('optimized.txt', 'hello again')
  expect(writeStat?.kind).toBe('file')
  expect(writeStat?.size).toBe(11)
})

test('readdir returns only name and kind fields', async () => {
  const { workspace } = await setupWorkspace()
  await workspace.mkdir('data', { recursive: false })
  await workspace.writeFile('data/a.txt', 'a')
  await workspace.mkdir('data/nested', { recursive: false })

  const entries = await workspace.readdir('data')
  for (const entry of entries) {
    expect(Object.keys(entry).sort()).toEqual(['kind', 'name'])
  }
})

test('unlink supports empty dir and rejects non-empty dir', async () => {
  const { root, workspace } = await setupWorkspace()
  await workspace.mkdir('empty', { recursive: false })
  await workspace.unlink('empty')

  await mkdir(join(root, 'non-empty'))
  await workspace.writeFile('non-empty/file.txt', 'x')
  await expect(workspace.unlink('non-empty')).rejects.toThrow()
})

test('path traversal vectors are rejected with categorized reasons', async () => {
  const { workspace } = await setupWorkspace()

  for (const vector of PATH_TRAVERSAL_CORPUS) {
    let requestedPath: string = vector
    if (vector === '<symlink-outside-workspace>') {
      requestedPath = '../outside-link'
    } else if (vector === '<path-ending-with-spaces>') {
      requestedPath = '../etc/passwd   '
    }

    await expect(workspace.readFile(requestedPath)).rejects.toSatisfy((error: unknown) => {
      return getReason(error) !== null
    })
  }
})

test('every operation rejects traversal attempts', async () => {
  const { workspace } = await setupWorkspace()
  const badPath = '../etc/passwd'

  await expect(workspace.readFile(badPath)).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.writeFile(badPath, 'x')).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.unlink(badPath)).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.readdir(badPath)).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.stat(badPath)).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.mkdir(badPath)).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.rename(badPath, 'ok.txt')).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(workspace.rename('ok.txt', badPath)).rejects.toMatchObject({ reason: 'path-escape' })
})
