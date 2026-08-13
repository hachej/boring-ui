import { expect, test } from 'vitest'

import { createSandboxRuntimeModeAdapter } from '../../sandboxRuntimeHost'

function createAdapter(getEnvVar: (name: string) => string | undefined) {
  return createSandboxRuntimeModeAdapter('vercel-sandbox', {
    providerOptions: { getEnvVar },
  })
}

test('mode preserves the missing-auth error', async () => {
  const adapter = createAdapter((name) => name === 'VERCEL_TEAM_ID' ? 'team-1' : undefined)

  await expect(adapter.create({ workspaceRoot: 'workspace-a', sessionId: 'session-a' }))
    .rejects.toThrow(
      'VERCEL_OIDC_TOKEN or VERCEL_ACCESS_TOKEN or VERCEL_TOKEN is required for vercel-sandbox mode',
    )
})

test('mode preserves the missing-team error', async () => {
  const adapter = createAdapter((name) => name === 'VERCEL_OIDC_TOKEN' ? 'token-1' : undefined)

  await expect(adapter.create({ workspaceRoot: 'workspace-a', sessionId: 'session-a' }))
    .rejects.toThrow('VERCEL_TEAM_ID is required for vercel-sandbox mode')
})
