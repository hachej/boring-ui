/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useChat: vi.fn(),
  defaultChatTransport: vi.fn(),
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: mocks.useChat,
}))

vi.mock('ai', () => ({
  DefaultChatTransport: mocks.defaultChatTransport,
}))

import { useAgentChat } from '../useAgentChat'

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

describe('useAgentChat stream resume', () => {
  const useChatOptions: Array<{ resume?: boolean }> = []
  let mockStatus: 'ready' | 'submitted' | 'streaming' | 'error'

  beforeEach(() => {
    useChatOptions.length = 0
    vi.clearAllMocks()
    localStorage.clear()
    mockStatus = 'ready'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    }))
    mocks.defaultChatTransport.mockImplementation((opts: unknown) => ({ opts }))
    mocks.useChat.mockImplementation((opts: { resume?: boolean }) => {
      useChatOptions.push(opts)
      return {
        id: 'mock-chat',
        messages: [],
        sendMessage: mocks.sendMessage,
        status: mockStatus,
        error: undefined,
        stop: mocks.stop,
        setMessages: mocks.setMessages,
      }
    })
  })

  test('does not start a resume stream for a turn just submitted in this tab', async () => {
    const { result, rerender } = renderHook(() => useAgentChat({ sessionId: 'sess-local-turn' }))

    expect(useChatOptions.at(-1)?.resume).toBe(false)

    await act(async () => {
      result.current.sendMessage({ text: 'hello', files: [] })
      await flushPromises()
    })

    await waitFor(() => expect(useChatOptions.length).toBeGreaterThan(1))
    expect(localStorage.getItem('boring-agent:status:sess-local-turn')).toBe('active')
    expect(useChatOptions.at(-1)?.resume).toBe(false)

    await act(async () => {
      mockStatus = 'streaming'
      rerender()
      await flushPromises()
    })
    await act(async () => {
      mockStatus = 'ready'
      rerender()
      await flushPromises()
    })

    await waitFor(() => expect(localStorage.getItem('boring-agent:status:sess-local-turn')).toBe('ready'))
    expect(useChatOptions.at(-1)?.resume).toBe(false)
  })

  test('still resumes an active turn after a fresh page load', () => {
    localStorage.setItem('boring-agent:status:sess-reload', 'active')

    renderHook(() => useAgentChat({ sessionId: 'sess-reload' }))

    expect(useChatOptions.at(-1)?.resume).toBe(true)
  })
})
