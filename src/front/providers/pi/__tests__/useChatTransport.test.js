import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useChatTransport, isPiBackendMode } from '../useChatTransport'
import { PiAgentCoreTransport } from '../piAgentCoreTransport'

// Mock the dependencies that would pull in real pi-agent-core / React Query
vi.mock('../defaultTools', () => ({
  createPiNativeTools: vi.fn(() => [
    { name: 'read_file', execute: vi.fn() },
    { name: 'write_file', execute: vi.fn() },
  ]),
}))

vi.mock('../../data', () => ({
  useDataProvider: vi.fn(() => ({
    files: { read: vi.fn(), write: vi.fn(), list: vi.fn() },
  })),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock('../../../utils/apiBase', () => ({
  buildApiUrl: vi.fn((path) => path),
}))

// Mock DefaultChatTransport from 'ai' package
vi.mock('ai', () => ({
  DefaultChatTransport: class MockDefaultChatTransport {
    constructor(opts) {
      this._api = opts?.api
      this._credentials = opts?.credentials
    }
    async sendMessages() { return new ReadableStream() }
    async reconnectToStream() { return null }
  },
}))

describe('isPiBackendMode', () => {
  it('returns false when capabilities is null', () => {
    expect(isPiBackendMode(null)).toBe(false)
  })

  it('returns false when capabilities is undefined', () => {
    expect(isPiBackendMode(undefined)).toBe(false)
  })

  it('returns false when mode is "local"', () => {
    expect(isPiBackendMode({ mode: 'local' })).toBe(false)
  })

  it('returns true when mode is "hosted"', () => {
    expect(isPiBackendMode({ mode: 'hosted' })).toBe(true)
  })

  it('returns true when piBackend flag is true', () => {
    expect(isPiBackendMode({ piBackend: true })).toBe(true)
  })

  it('returns false when no mode or piBackend flag', () => {
    expect(isPiBackendMode({})).toBe(false)
  })
})

describe('useChatTransport', () => {
  it('returns PiAgentCoreTransport in browser mode (default)', () => {
    const { result } = renderHook(() => useChatTransport(null))
    expect(result.current).toBeInstanceOf(PiAgentCoreTransport)
  })

  it('returns PiAgentCoreTransport when capabilities.mode is "local"', () => {
    const { result } = renderHook(() => useChatTransport({ mode: 'local' }))
    expect(result.current).toBeInstanceOf(PiAgentCoreTransport)
  })

  it('returns DefaultChatTransport when mode is "hosted"', () => {
    const { result } = renderHook(() => useChatTransport({ mode: 'hosted' }))
    // Not PiAgentCoreTransport — should be the default (server) transport
    expect(result.current).not.toBeInstanceOf(PiAgentCoreTransport)
    expect(result.current).toHaveProperty('sendMessages')
    expect(result.current).toHaveProperty('reconnectToStream')
    expect(result.current._api).toBe('/api/v1/agent/chat')
  })

  it('returns same transport instance across re-renders (ref stability)', () => {
    const { result, rerender } = renderHook(() => useChatTransport(null))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('transport instance has sendMessages and reconnectToStream methods', () => {
    const { result } = renderHook(() => useChatTransport(null))
    expect(typeof result.current.sendMessages).toBe('function')
    expect(typeof result.current.reconnectToStream).toBe('function')
  })
})
