import { expect, test } from 'vitest'

import {
  buildBwrapArgs,
  createBwrapSandbox,
  createDirectSandbox,
  createNodeWorkspace,
  FileHandleStore,
  getNodeWorkspaceHostRoot,
} from '../index'

test('providers barrel exposes direct, bwrap, node workspace, and Vercel providers', () => {
  const workspace = createNodeWorkspace('/tmp/boring-sandbox-provider-barrel', {
    runtimeContext: { runtimeCwd: '/workspace' },
  })

  expect(createDirectSandbox().provider).toBe('direct')
  expect(createBwrapSandbox().provider).toBe('bwrap')
  expect(getNodeWorkspaceHostRoot(workspace)).toBe('/tmp/boring-sandbox-provider-barrel')
  expect(buildBwrapArgs('/tmp/boring-sandbox-provider-barrel')).toContain('--unshare-all')
  expect(new FileHandleStore({ storePath: '/tmp/boring-sandbox-provider-barrel.json' })).toBeInstanceOf(FileHandleStore)
})
