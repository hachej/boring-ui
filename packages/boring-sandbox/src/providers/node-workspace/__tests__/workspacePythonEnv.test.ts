import { expect, test } from 'vitest'

import { withWorkspacePythonEnv } from '../workspacePythonEnv'

test('sandbox runtime env rewrites host workspace roots to sandbox roots', () => {
  const env = withWorkspacePythonEnv({
    workspaceRoot: '/host/workspace',
    sandboxRoot: '/workspace',
    env: {
      BORING_AGENT_WORKSPACE_ROOT: '/host/workspace',
      VIRTUAL_ENV: '/host/workspace/.boring-agent/venv',
      PATH: '/usr/bin',
    },
  })

  expect(env.BORING_AGENT_WORKSPACE_ROOT).toBe('/workspace')
  expect(env.VIRTUAL_ENV).toBe('/workspace/.boring-agent/venv')
  expect(env.PATH?.split(':').slice(0, 3)).toEqual([
    '/workspace/.boring-agent/node/node_modules/.bin',
    '/workspace/.boring-agent/venv/bin',
    '/workspace/.boring-agent/sdk/uv/bin',
  ])
})

test('isolated sandbox modes rewrite HOME to the sandbox runtime root', () => {
  const env = withWorkspacePythonEnv({
    workspaceRoot: '/host/workspace',
    sandboxRoot: '/workspace',
    env: { HOME: '/home/ubuntu', PATH: '/usr/bin' },
  })

  expect(env.HOME).toBe('/workspace')
})

test('HOME is rewritten by default even without a sandboxRoot (e.g. vercel)', () => {
  // The vercel-sandbox adapter does not pass sandboxRoot but is still an
  // isolated remote runtime, so HOME must be rewritten to the runtime root.
  const env = withWorkspacePythonEnv({
    workspaceRoot: '/workspace',
    env: { HOME: '/plugin-home', PATH: '/usr/bin' },
  })

  expect(env.HOME).toBe('/workspace')
})

test('preserveHostHome keeps the host HOME so host-auth CLIs keep working', () => {
  const env = withWorkspacePythonEnv({
    workspaceRoot: '/host/workspace',
    env: { HOME: '/home/ubuntu', PATH: '/usr/bin' },
    preserveHostHome: true,
  })

  // HOME must stay on the host so gh/git resolve their host config/auth, while
  // the workspace-scoped python/venv vars are still rewritten to the workspace.
  expect(env.HOME).toBe('/home/ubuntu')
  expect(env.VIRTUAL_ENV).toBe('/host/workspace/.boring-agent/venv')
  expect(env.BORING_AGENT_WORKSPACE_ROOT).toBe('/host/workspace')
})
