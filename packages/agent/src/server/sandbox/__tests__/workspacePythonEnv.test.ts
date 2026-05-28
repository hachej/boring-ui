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
