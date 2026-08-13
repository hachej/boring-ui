import { expect, test } from 'vitest'

import { createSandboxRuntimeModeAdapter } from '../../sandboxRuntimeHost'

test('Blaxel mode is a best-effort remote workspace without periodic wake checks', () => {
  const adapter = createSandboxRuntimeModeAdapter('blaxel')
  expect(adapter.id).toBe('blaxel')
  expect(adapter.workspaceFsCapability).toBe('best-effort')
  expect(adapter.cachedBindingHealthCheck).toBeUndefined()
  expect(adapter.getRuntimeLayoutRoot?.({ workspaceRoot: '/host', workspaceId: 'w', sessionId: 's' })).toBe('/workspace')
})
