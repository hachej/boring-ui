import { describe, expect, it, vi } from 'vitest'
import { RemotePiSession } from '../remotePiSession'

const receipt = {
  accepted: true,
  cursor: 1,
  clientNonce: 'nonce',
  nativeSessionId: 'native-1',
  session: {
    id: 'native-1', nativeSessionId: 'native-1', title: 'hello',
    createdAt: '2026-06-04T00:00:00.000Z', updatedAt: '2026-06-04T00:00:00.000Z', turnCount: 1, hasAssistantReply: false,
  },
}

describe('RemotePiSession native first send', () => {
  it('shares one first-send key and performs one same-key reconciliation after response loss', async () => {
    const adopted = vi.fn()
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 202 }))
    const session = new RemotePiSession({
      sessionId: 'local-1',
      autoStart: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: adopted },
    })

    await Promise.all([
      session.prompt({ message: 'hello', clientNonce: 'nonce' }),
      session.prompt({ message: 'hello', clientNonce: 'nonce' }),
    ])

    expect(fetch).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const retry = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(first.nativeSessionStart).toMatchObject({ retry: false })
    expect(retry.nativeSessionStart).toEqual({ ...first.nativeSessionStart, retry: true })
    expect(adopted).toHaveBeenCalledWith(receipt.session)
  })
})
