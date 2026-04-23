import { expect, test } from 'vitest'

import { PATH_TRAVERSAL_CORPUS } from '../../__tests__/fixtures/pathTraversalCorpus'
import { runPathTraversalCorpus } from '../../__tests__/fixtures/runPathTraversalCorpus'

test('path traversal corpus has baseline coverage', () => {
  expect(PATH_TRAVERSAL_CORPUS.length).toBeGreaterThanOrEqual(20)
  expect(PATH_TRAVERSAL_CORPUS).toContain('../etc/passwd')
  expect(PATH_TRAVERSAL_CORPUS).toContain('..%2Fetc%2Fpasswd')
  expect(PATH_TRAVERSAL_CORPUS).toContain('<symlink-outside-workspace>')
})

test('runPathTraversalCorpus passes when all vectors reject', async () => {
  const rejections: string[] = []
  const workspace = {
    async readFile(path: string): Promise<string> {
      throw new Error(`blocked: ${path}`)
    },
  }

  await expect(
    runPathTraversalCorpus(workspace, {
      logRejection(entry) {
        rejections.push(`[path-attack] rejected: ${entry.vector} -> ${entry.reason}`)
      },
    }),
  ).resolves.toBeUndefined()

  expect(rejections).toHaveLength(PATH_TRAVERSAL_CORPUS.length)
  expect(rejections[0]).toContain('[path-attack] rejected:')
})

test('runPathTraversalCorpus fails when any vector succeeds', async () => {
  const allowedVector = '../etc/passwd'
  const workspace = {
    async readFile(path: string): Promise<string> {
      if (path === allowedVector) {
        return 'unexpectedly allowed'
      }
      throw new Error(`blocked: ${path}`)
    },
  }

  await expect(runPathTraversalCorpus(workspace)).rejects.toThrow(allowedVector)
})
