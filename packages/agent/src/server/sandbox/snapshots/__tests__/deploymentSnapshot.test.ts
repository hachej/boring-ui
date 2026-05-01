import { expect, test, vi } from 'vitest'

import {
  buildDeploymentSnapshotRecipe,
  prepareDeploymentSnapshot,
  UV_SETUP_COMMANDS,
  type DeploymentSnapshotProvider,
} from '../deploymentSnapshot'

test('buildDeploymentSnapshotRecipe is provider-neutral and includes uv by default', () => {
  expect(buildDeploymentSnapshotRecipe({ setupCommands: ['echo extra'] })).toEqual({
    runtime: undefined,
    systemPackages: undefined,
    pythonPackages: undefined,
    setupCommands: [...UV_SETUP_COMMANDS, 'echo extra'],
  })
})

test('buildDeploymentSnapshotRecipe can opt out of uv setup', () => {
  expect(buildDeploymentSnapshotRecipe({ includeUv: false, setupCommands: ['echo only'] })).toEqual({
    runtime: undefined,
    systemPackages: undefined,
    pythonPackages: undefined,
    setupCommands: ['echo only'],
  })
})

test('prepareDeploymentSnapshot delegates to provider implementation', async () => {
  const provider: DeploymentSnapshotProvider = {
    prepareDeploymentSnapshot: vi.fn(async () => ({
      status: 'baked' as const,
      reason: 'baked',
      snapshotId: 'snap-generic',
    })),
  }
  const recipe = buildDeploymentSnapshotRecipe({ runtime: 'python3.13' })

  await expect(prepareDeploymentSnapshot(provider, recipe)).resolves.toMatchObject({
    status: 'baked',
    snapshotId: 'snap-generic',
  })
  expect(provider.prepareDeploymentSnapshot).toHaveBeenCalledWith(recipe)
})
