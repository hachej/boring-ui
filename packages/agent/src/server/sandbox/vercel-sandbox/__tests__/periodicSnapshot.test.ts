import { afterEach, expect, test, vi } from 'vitest'

import { applySnapshotRetention, type SnapshotHandle } from '../periodicSnapshot'

interface MockSnapshot extends SnapshotHandle {
  delete: ReturnType<typeof vi.fn>
}

function createSnapshot(snapshotId: string): MockSnapshot {
  return {
    snapshotId,
    delete: vi.fn(async () => {
      // no-op
    }),
  }
}

function createEnvGetter(value: string | undefined): (name: string) => string | undefined {
  return (name: string) => {
    if (name !== 'BORING_AGENT_SNAPSHOT_KEEP') {
      return undefined
    }
    return value
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('third snapshot deletes the oldest with default keep-last-2 policy', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-default'
  const first = createSnapshot('snap-1')
  const second = createSnapshot('snap-2')
  const third = createSnapshot('snap-3')

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId)

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(second.delete).not.toHaveBeenCalled()
  expect(third.delete).not.toHaveBeenCalled()
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-3', 'snap-2'])
})

test('retention is a no-op when only one or two snapshots exist', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-noop'
  const first = createSnapshot('snap-a')
  const second = createSnapshot('snap-b')

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId)

  expect(first.delete).not.toHaveBeenCalled()
  expect(second.delete).not.toHaveBeenCalled()
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-b', 'snap-a'])
})

test('BORING_AGENT_SNAPSHOT_KEEP bounds retention window', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-env'
  const getEnvVar = createEnvGetter('3')
  const first = createSnapshot('snap-1')
  const second = createSnapshot('snap-2')
  const third = createSnapshot('snap-3')
  const fourth = createSnapshot('snap-4')

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId, { getEnvVar })
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId, { getEnvVar })
  await applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId, { getEnvVar })
  await applySnapshotRetention(workspaceId, fourth, snapshotsByWorkspaceId, { getEnvVar })

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(second.delete).not.toHaveBeenCalled()
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-4', 'snap-3', 'snap-2'])
})

test('invalid BORING_AGENT_SNAPSHOT_KEEP values fall back to default keep-last-2', async () => {
  for (const raw of ['0', '-1', 'abc', '1.5']) {
    const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
    const workspaceId = `workspace-retention-invalid-${raw}`
    const first = createSnapshot('snap-1')
    const second = createSnapshot('snap-2')
    const third = createSnapshot('snap-3')
    const getEnvVar = createEnvGetter(raw)

    await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId, { getEnvVar })
    await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId, { getEnvVar })
    await applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId, { getEnvVar })

    expect(first.delete).toHaveBeenCalledTimes(1)
    expect(
      snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
    ).toEqual(['snap-3', 'snap-2'])
  }
})

test('retention attempts all stale deletes and keeps failed ones tracked', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-delete-failure'

  const first = createSnapshot('snap-1')
  const second = createSnapshot('snap-2')
  const third = createSnapshot('snap-3')
  first.delete.mockImplementationOnce(async () => {
    throw new Error('delete failed')
  })

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId)
  await expect(
    applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId),
  ).rejects.toThrow('delete failed')

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-3', 'snap-2', 'snap-1'])
})
