import { describe, expect, test, vi } from 'vitest'

import { closeOneChatStartupServices } from '../startupLifecycle'

describe('startup lifecycle cleanup', () => {
  test('closes every started service in reverse order even when one close fails', async () => {
    const calls: string[] = []
    const close = (name: string, failure?: Error) =>
      vi.fn(async () => {
        calls.push(name)
        if (failure) throw failure
      })
    const startupFailure = new Error('runtime close failed')

    await expect(
      closeOneChatStartupServices({
        vite: { close: close('vite') },
        runtime: { close: close('runtime', startupFailure) },
        registry: { close: close('registry') },
        runtimeModeAdapter: { dispose: close('adapter') },
      }),
    ).rejects.toBe(startupFailure)
    expect(calls).toEqual(['vite', 'runtime', 'registry', 'adapter'])
  })
})
