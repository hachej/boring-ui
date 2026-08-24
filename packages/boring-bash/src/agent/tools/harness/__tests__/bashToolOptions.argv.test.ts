import { expect, test, vi } from 'vitest'

import type { RuntimeBundle } from '../../../runtime/types'
import { buildBwrapArgs } from '../../../runtime/buildBwrapArgs'
import { createBashToolOptionsForRuntime } from '../bashToolOptions'

function createBundle(): RuntimeBundle {
  return {
    storageRoot: '/tmp/workspace',
    workspace: { root: '/workspace' } as RuntimeBundle['workspace'],
    sandbox: {
      placement: 'server',
      provider: 'bwrap',
    } as RuntimeBundle['sandbox'],
    fileSearch: {} as RuntimeBundle['fileSearch'],
    bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
    runtimeHost: {
      buildBwrapArgs(workspaceRoot, options) {
        return buildBwrapArgs(workspaceRoot, {
          ...options,
          namespaceProfile: 'docker',
          network: 'shared',
          dropAllCapabilities: true,
        })
      },
      withWorkspacePythonEnv: vi.fn(() => ({})),
    },
  }
}

test('local Agent bash spawn hook captures docker-profile bwrap argv', () => {
  const options = createBashToolOptionsForRuntime(createBundle())
  const spawned = options.spawnHook?.({
    command: 'printf hello',
    cwd: '/tmp/workspace',
    env: {},
  })

  expect(spawned).toBeDefined()
  expect(spawned?.command).toContain("'bwrap' '--unshare-ipc' '--unshare-pid' '--unshare-uts' '--unshare-cgroup'")
  expect(spawned?.command).toContain("'--cap-drop' 'ALL'")
  expect(spawned?.command).not.toContain('--unshare-all')
  expect(spawned?.command).toContain("--' bash -lc 'printf hello'")
})
