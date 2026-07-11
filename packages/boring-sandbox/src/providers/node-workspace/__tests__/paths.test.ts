import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { PATH_TRAVERSAL_CORPUS } from '../../__tests__/fixtures/pathTraversalCorpus'
import {
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  type PathRejectReason,
  validatePath,
} from '../paths'

const REASONS: PathRejectReason[] = [
  'path-escape',
  'absolute-path',
  'null-byte',
  'symlink-escape',
]

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

function getRejectReason(error: unknown): PathRejectReason | null {
  const reason = (error as { reason?: string }).reason
  return REASONS.includes(reason as PathRejectReason) ? (reason as PathRejectReason) : null
}

test('validatePath rejects traversal categories with stable reason codes', () => {
  const root = '/tmp/workspace'
  const vectors: Array<[string, PathRejectReason]> = [
    ['foo\x00bar', 'null-byte'],
    ['/etc/passwd', 'absolute-path'],
    ['C:\\Windows\\System32', 'absolute-path'],
    ['../etc/passwd', 'path-escape'],
    ['..%2Fetc%2Fpasswd', 'path-escape'],
    ['~/.ssh/id_rsa', 'path-escape'],
    ['$HOME/.ssh/id_rsa', 'path-escape'],
  ]

  for (const [vector, expectedReason] of vectors) {
    try {
      validatePath(root, vector)
      throw new Error(`Expected validatePath to reject ${vector}`)
    } catch (error) {
      expect(getRejectReason(error)).toBe(expectedReason)
    }
  }
})

test('ensureExistingWorkspacePath rejects every vector in traversal corpus with categorized reason', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-paths-ws-'))
  const outsideRoot = await mkdtemp(join(tmpdir(), 'boring-ui-paths-outside-'))
  tempDirs.push(workspaceRoot, outsideRoot)

  const outsideFile = join(outsideRoot, 'escape.txt')
  await writeFile(outsideFile, 'outside')
  await symlink(outsideRoot, join(workspaceRoot, 'link-out'))

  const rejectionLogs: string[] = []

  for (const vector of PATH_TRAVERSAL_CORPUS) {
    let requestedPath: string = vector
    if (vector === '<symlink-outside-workspace>') {
      requestedPath = 'link-out/escape.txt'
    } else if (vector === '<path-ending-with-spaces>') {
      requestedPath = '../etc/passwd   '
    }

    try {
      await ensureExistingWorkspacePath(workspaceRoot, requestedPath)
      throw new Error(`Traversal vector unexpectedly accepted: ${vector}`)
    } catch (error) {
      const reason = getRejectReason(error)
      expect(reason).not.toBeNull()
      rejectionLogs.push(`[path-attack] rejected: ${vector} -> ${reason}`)
    }
  }

  expect(rejectionLogs).toHaveLength(PATH_TRAVERSAL_CORPUS.length)
})

test('ensureWritableWorkspacePath keeps parent realpath inside workspace', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-paths-writable-'))
  const outsideRoot = await mkdtemp(join(tmpdir(), 'boring-ui-paths-writable-outside-'))
  tempDirs.push(workspaceRoot, outsideRoot)

  await mkdir(join(workspaceRoot, 'safe'), { recursive: true })
  await symlink(outsideRoot, join(workspaceRoot, 'unsafe-parent'))

  await expect(
    ensureWritableWorkspacePath(workspaceRoot, 'unsafe-parent/file.txt'),
  ).rejects.toMatchObject({ reason: 'symlink-escape' })
})
