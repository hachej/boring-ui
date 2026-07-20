import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

import { buildDeploymentSnapshotRecipe, UV_SETUP_COMMANDS } from '../snapshotRecipe'
import {
  createVercelDeploymentSnapshotProvider,
  prepareVercelDeploymentSnapshot,
  VERCEL_UV_SETUP_COMMANDS,
} from '../deploymentSnapshot'
import type { VercelBakeClient, VercelBakeSandbox } from '../bake'

const tempDirs: string[] = []

function createCommandResult(exitCode: number, stdout = '', stderr = '') {
  return {
    exitCode,
    stdout: async () => stdout,
    stderr: async () => stderr,
  }
}

function createMockSandbox() {
  const scripts: string[] = []
  const sandbox = {
    runCommand: vi.fn(async (command: string, args: string[] = []) => {
      const script = command === 'sh' && args[0] === '-c'
        ? (args[1] ?? '')
        : [command, ...args].join(' ').trim()
      scripts.push(script)
      return createCommandResult(0)
    }),
    snapshot: vi.fn(async () => ({ snapshotId: 'snap-deploy' })),
    stop: vi.fn(async () => {}),
  } as unknown as VercelBakeSandbox
  return { sandbox, scripts }
}

async function makeCachePath(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'boring-ui-deploy-snapshot-'))
  tempDirs.push(root)
  return path.join(root, 'snapshot-cache.json')
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('deployment snapshot bakes uv setup commands for sandbox reuse', async () => {
  const cachePath = await makeCachePath()
  const mock = createMockSandbox()
  const client: VercelBakeClient = {
    create: vi.fn(async () => mock.sandbox),
  }

  const result = await prepareVercelDeploymentSnapshot({
    client,
    cachePath,
    setupCommands: buildDeploymentSnapshotRecipe({
      setupCommands: ['echo app-specific-runtime-setup'],
    }).setupCommands,
  })

  expect(result).toMatchObject({
    status: 'baked',
    reason: 'baked',
    snapshotId: 'snap-deploy',
  })
  expect(mock.scripts).toEqual([
    ...VERCEL_UV_SETUP_COMMANDS,
    'echo app-specific-runtime-setup',
  ])
})

test('vercel provider adapts generic deployment snapshot recipe', async () => {
  const cachePath = await makeCachePath()
  const mock = createMockSandbox()
  const client: VercelBakeClient = {
    create: vi.fn(async () => mock.sandbox),
  }
  const provider = createVercelDeploymentSnapshotProvider({ client, cachePath })

  const result = await provider.prepareDeploymentSnapshot(
    buildDeploymentSnapshotRecipe({ setupCommands: ['echo provider'] }),
  )

  expect(result).toMatchObject({ status: 'baked', snapshotId: 'snap-deploy' })
  expect(mock.scripts).toEqual([...UV_SETUP_COMMANDS, 'echo provider'])
})

test('configured deployment snapshot id skips bake', async () => {
  const cachePath = await makeCachePath()
  const client: VercelBakeClient = {
    create: vi.fn(async () => {
      throw new Error('should not create')
    }),
  }

  const result = await prepareVercelDeploymentSnapshot({
    client,
    cachePath,
    snapshotId: 'snap-existing',
  })

  expect(result).toMatchObject({
    status: 'skipped',
    reason: 'snapshot-id-configured',
    snapshotId: 'snap-existing',
  })
  expect(client.create).not.toHaveBeenCalled()
})
