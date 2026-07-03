import { test as loggingTest, type LoggingFixture } from './fixtures/loggingHarness'
import { expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatLogs,
  spawnBackend,
  type SpawnedBackend,
} from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'
import {
  createE2eWorkspace,
  type E2eWorkspace,
} from './helpers/workspace'

interface E2eFixtures {
  workspace: E2eWorkspace
  backend: SpawnedBackend
  browserPage: Page
  logging: LoggingFixture
}

const fixturesDir = path.dirname(fileURLToPath(import.meta.url))

export const test = loggingTest.extend<E2eFixtures>({
  workspace: async ({}, use) => {
    const workspace = await createE2eWorkspace()
    try {
      await use(workspace)
    } finally {
      await workspace.cleanup()
    }
  },
  backend: async ({ workspace }, use, testInfo) => {
    const repoRoot = path.resolve(fixturesDir, '..', '..', '..')
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
    })

    try {
      await use(backend)
    } finally {
      await testInfo.attach('backend-stdout.log', {
        body: Buffer.from(`${backend.logs.stdout.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      await testInfo.attach('backend-stderr.log', {
        body: Buffer.from(`${backend.logs.stderr.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      await backend.stop()

      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('backend-combined.log', {
          body: Buffer.from(formatLogs(backend.logs), 'utf8'),
          contentType: 'text/plain',
        })
      }
    }
  },
  browserPage: async ({ page, backend }, use) => {
    await navigateBrowserToBackend(page, backend.browserUrl)
    await use(page)
  },
})

export { expect }
