import { afterEach, expect, test, vi } from 'vitest'

import { createSandboxRuntimeModeAdapter } from '../../sandboxRuntimeHost'

const VERCEL_AUTH_ENV_NAMES = [
  'VERCEL_OIDC_TOKEN',
  'VERCEL_ACCESS_TOKEN',
  'VERCEL_TOKEN',
  'VERCEL_TEAM_ID',
] as const

function createAdapter(env: Readonly<Record<string, string>> = {}) {
  for (const name of VERCEL_AUTH_ENV_NAMES) vi.stubEnv(name, env[name] ?? '')
  return createSandboxRuntimeModeAdapter('vercel-sandbox')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

test('mode preserves the missing-auth error', async () => {
  const adapter = createAdapter({ VERCEL_TEAM_ID: 'team-1' })

  await expect(adapter.create({ workspaceRoot: 'workspace-a', sessionId: 'session-a' }))
    .rejects.toThrow(
      'VERCEL_OIDC_TOKEN or VERCEL_ACCESS_TOKEN or VERCEL_TOKEN is required for vercel-sandbox mode',
    )
})

test('mode preserves the missing-team error', async () => {
  const adapter = createAdapter({ VERCEL_OIDC_TOKEN: 'token-1' })

  await expect(adapter.create({ workspaceRoot: 'workspace-a', sessionId: 'session-a' }))
    .rejects.toThrow('VERCEL_TEAM_ID is required for vercel-sandbox mode')
})
