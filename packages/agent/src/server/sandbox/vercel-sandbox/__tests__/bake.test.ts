import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

import {
  bakeSnapshotIfNeeded,
  buildPackageHash,
  type VercelBakeClient,
  type VercelBakeSandbox,
} from '../bake'

const tempDirs: string[] = []

function createCommandResult(exitCode: number, stdout = '', stderr = '') {
  return {
    exitCode,
    stdout: async () => stdout,
    stderr: async () => stderr,
  }
}

function createMockSandbox(opts?: {
  failScriptPattern?: RegExp
  snapshotId?: string
}) {
  const scripts: string[] = []
  const runCommand = vi.fn(async (
    command: string,
    args: string[] = [],
  ) => {
    const script = command === 'sh' && args[0] === '-c'
      ? (args[1] ?? '')
      : [command, ...args].join(' ').trim()
    scripts.push(script)

    if (opts?.failScriptPattern?.test(script)) {
      return createCommandResult(1, '', 'install failed')
    }

    return createCommandResult(0, '', '')
  })

  const snapshot = vi.fn(async () => ({ snapshotId: opts?.snapshotId ?? 'snap-baked' }))
  const stop = vi.fn(async () => {})
  const sandbox = { runCommand, snapshot, stop } as unknown as VercelBakeSandbox

  return {
    sandbox,
    scripts,
    runCommand,
    snapshot,
    stop,
  }
}

async function makeCachePath(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `boring-ui-bake-${name}-`))
  tempDirs.push(root)
  return path.join(root, 'vercel-snapshot-cache.json')
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

test('bake executes end-to-end and caches snapshot id', async () => {
  const cachePath = await makeCachePath('e2e')
  const sandbox = createMockSandbox({ snapshotId: 'snap-123' })
  const client: VercelBakeClient = {
    create: vi.fn(async () => sandbox.sandbox),
  }

  const result = await bakeSnapshotIfNeeded({
    client,
    cachePath,
    pythonPackages: ['numpy', 'pandas'],
    systemPackages: ['jq', 'ripgrep'],
  })

  expect(result).toMatchObject({
    status: 'baked',
    reason: 'baked',
    snapshotId: 'snap-123',
  })
  expect(client.create).toHaveBeenCalledWith({ runtime: 'python3.13' })
  expect(sandbox.scripts).toEqual([
    `dnf install -y 'jq' 'ripgrep'`,
    `python3 -m pip install 'numpy' 'pandas'`,
  ])
  expect(sandbox.snapshot).toHaveBeenCalledTimes(1)
  expect(sandbox.stop).toHaveBeenCalledTimes(1)

  const cacheRaw = await readFile(cachePath, 'utf8')
  const cache = JSON.parse(cacheRaw) as {
    version: number
    entries: Record<string, { snapshotId: string }>
  }
  expect(cache.version).toBe(1)
  expect(Object.values(cache.entries)[0]?.snapshotId).toBe('snap-123')
})

test('buildPackageHash is stable across package order and whitespace', () => {
  const hashA = buildPackageHash({
    pythonPackages: [' pandas ', 'numpy'],
    systemPackages: ['jq', 'ripgrep'],
  })
  const hashB = buildPackageHash({
    pythonPackages: ['numpy', 'pandas'],
    systemPackages: ['ripgrep', 'jq'],
  })

  expect(hashA).toBe(hashB)
})

test('existing cache skips bake', async () => {
  const cachePath = await makeCachePath('cache-hit')
  const firstSandbox = createMockSandbox({ snapshotId: 'snap-cached' })
  const firstClient: VercelBakeClient = {
    create: vi.fn(async () => firstSandbox.sandbox),
  }

  const initial = await bakeSnapshotIfNeeded({
    client: firstClient,
    cachePath,
    pythonPackages: ['pandas', 'numpy'],
    systemPackages: ['jq'],
  })
  expect(initial.status).toBe('baked')

  const secondClient: VercelBakeClient = {
    create: vi.fn(async () => {
      throw new Error('should not create on cache hit')
    }),
  }
  const cached = await bakeSnapshotIfNeeded({
    client: secondClient,
    cachePath,
    pythonPackages: ['numpy', 'pandas'],
    systemPackages: ['jq'],
  })

  expect(cached).toMatchObject({
    status: 'cache-hit',
    reason: 'cache-hit',
    snapshotId: 'snap-cached',
  })
  expect(secondClient.create).not.toHaveBeenCalled()
})

test('bake failure logs warning and falls back without throwing', async () => {
  const cachePath = await makeCachePath('failure')
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
  }
  const failingSandbox = createMockSandbox({ failScriptPattern: /^python3 -m pip install/ })
  const client: VercelBakeClient = {
    create: vi.fn(async () => failingSandbox.sandbox),
  }

  const result = await bakeSnapshotIfNeeded({
    client,
    cachePath,
    pythonPackages: ['pandas'],
    systemPackages: [],
    logger,
  })

  expect(result.status).toBe('failed')
  expect(result.reason).toBe('bake-failed')
  expect(logger.warn).toHaveBeenCalledTimes(1)
  expect(failingSandbox.snapshot).not.toHaveBeenCalled()
  expect(failingSandbox.stop).toHaveBeenCalledTimes(1)
})

test('configured snapshot id skips bake work', async () => {
  const cachePath = await makeCachePath('configured-snapshot')
  const client: VercelBakeClient = {
    create: vi.fn(async () => {
      throw new Error('create should not run when snapshot_id is configured')
    }),
  }

  const result = await bakeSnapshotIfNeeded({
    client,
    cachePath,
    snapshotId: 'snap-configured',
    pythonPackages: ['pandas'],
  })

  expect(result).toMatchObject({
    status: 'skipped',
    reason: 'snapshot-id-configured',
    snapshotId: 'snap-configured',
  })
  expect(client.create).not.toHaveBeenCalled()
})

test('setup commands are baked and cached as part of the recipe', async () => {
  const cachePath = await makeCachePath('setup-commands')
  const sandbox = createMockSandbox({ snapshotId: 'snap-setup' })
  const client: VercelBakeClient = {
    create: vi.fn(async () => sandbox.sandbox),
  }

  const result = await bakeSnapshotIfNeeded({
    client,
    cachePath,
    setupCommands: ['command -v uv || python3 -m pip install uv', 'uv --version'],
  })

  expect(result).toMatchObject({
    status: 'baked',
    reason: 'baked',
    snapshotId: 'snap-setup',
  })
  expect(sandbox.scripts).toEqual([
    'command -v uv || python3 -m pip install uv',
    'uv --version',
  ])
})

test('no packages or setup commands configured skips bake', async () => {
  const cachePath = await makeCachePath('no-packages')
  const client: VercelBakeClient = {
    create: vi.fn(async () => {
      throw new Error('create should not run when no packages are configured')
    }),
  }

  const result = await bakeSnapshotIfNeeded({
    client,
    cachePath,
    pythonPackages: ['   '],
    systemPackages: [],
  })

  expect(result).toMatchObject({
    status: 'skipped',
    reason: 'no-packages',
  })
  expect(client.create).not.toHaveBeenCalled()
})
