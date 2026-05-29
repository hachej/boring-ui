import { expect, test, vi } from 'vitest'

import {
  buildDeploymentSnapshotRecipe,
  NODE_UV_SETUP_COMMANDS,
  prepareDeploymentSnapshot,
  uvSetupCommandsForRuntime,
  UV_SETUP_COMMANDS,
  VERCEL_UV_BIN,
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

test('Node-family runtimes get pip+uv bootstrap with explicit UV_BIN (no bare uv)', () => {
  for (const runtime of ['node22', 'node24', 'node26', 'NODE24']) {
    const recipe = buildDeploymentSnapshotRecipe({ runtime, setupCommands: ['echo extra'] })
    // Detailed logging so a failure shows exactly which runtime + commands diverged.
    expect(recipe.setupCommands, `setupCommands for runtime=${runtime}`).toEqual([
      ...NODE_UV_SETUP_COMMANDS,
      'echo extra',
    ])
    const joined = (recipe.setupCommands ?? []).join('\n')
    expect(joined, `runtime=${runtime} must install python3-pip via sudo dnf`).toContain(
      'sudo dnf install -y python3-pip',
    )
    expect(joined, `runtime=${runtime} must install uv with --user`).toContain(
      'python3 -m pip install --user --upgrade uv',
    )
    expect(joined, `runtime=${runtime} must verify the explicit UV_BIN`).toContain(
      `${VERCEL_UV_BIN} --version`,
    )
    // Invariant: the Node bootstrap verifies uv via the explicit UV_BIN, never
    // the bare `uv --version` (correctness must not depend on PATH propagation).
    expect(recipe.setupCommands, `runtime=${runtime} must not verify via bare uv`).not.toContain(
      'uv --version',
    )
  }
})

test('Python-family runtimes keep the on-PATH uv setup', () => {
  const recipe = buildDeploymentSnapshotRecipe({ runtime: 'python3.13', setupCommands: ['echo x'] })
  expect(recipe.setupCommands).toEqual([...UV_SETUP_COMMANDS, 'echo x'])
})

test('includeUv:false drops uv setup regardless of runtime family', () => {
  expect(buildDeploymentSnapshotRecipe({ runtime: 'node24', includeUv: false }).setupCommands).toEqual([])
  expect(buildDeploymentSnapshotRecipe({ runtime: 'python3.13', includeUv: false }).setupCommands).toEqual([])
})

test('uvSetupCommandsForRuntime selects family-appropriate commands', () => {
  expect(uvSetupCommandsForRuntime('node24')).toBe(NODE_UV_SETUP_COMMANDS)
  expect(uvSetupCommandsForRuntime('python3.13')).toBe(UV_SETUP_COMMANDS)
  expect(uvSetupCommandsForRuntime(undefined)).toBe(UV_SETUP_COMMANDS)
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
