import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock appConfig before importing the hook
vi.mock('../../config/appConfig', () => ({
  getConfig: vi.fn(() => null),
}))

import { useChatCenteredShell } from '../useChatCenteredShell'
import { getConfig } from '../../config/appConfig'

describe('useChatCenteredShell', () => {
  let originalLocation

  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue(null)
    // Save original location and set up a writable search property
    originalLocation = window.location
    delete window.location
    window.location = { ...originalLocation, search: '' }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  it('returns { enabled: false } when features.chatCenteredShell is false', () => {
    vi.mocked(getConfig).mockReturnValue({
      features: { chatCenteredShell: false },
    })

    const { result } = renderHook(() => useChatCenteredShell())
    expect(result.current.enabled).toBe(false)
  })

  it('returns { enabled: true } when features.chatCenteredShell is true', () => {
    vi.mocked(getConfig).mockReturnValue({
      features: { chatCenteredShell: true },
    })

    const { result } = renderHook(() => useChatCenteredShell())
    expect(result.current.enabled).toBe(true)
  })

  it('query param ?shell=chat-centered overrides flag to true', () => {
    vi.mocked(getConfig).mockReturnValue({
      features: { chatCenteredShell: false },
    })

    window.location.search = '?shell=chat-centered'

    const { result } = renderHook(() => useChatCenteredShell())
    expect(result.current.enabled).toBe(true)
  })

  it('query param ?shell=legacy overrides flag to false', () => {
    vi.mocked(getConfig).mockReturnValue({
      features: { chatCenteredShell: true },
    })

    window.location.search = '?shell=legacy'

    const { result } = renderHook(() => useChatCenteredShell())
    expect(result.current.enabled).toBe(false)
  })

  it('returns { enabled: false } when config is null (not yet loaded)', () => {
    vi.mocked(getConfig).mockReturnValue(null)

    const { result } = renderHook(() => useChatCenteredShell())
    expect(result.current.enabled).toBe(false)
  })

  it('returns { enabled: false } when features object is missing', () => {
    vi.mocked(getConfig).mockReturnValue({})

    const { result } = renderHook(() => useChatCenteredShell())
    expect(result.current.enabled).toBe(false)
  })

  it('query param takes precedence over config in both directions', () => {
    // Config says true, param says legacy => false
    vi.mocked(getConfig).mockReturnValue({
      features: { chatCenteredShell: true },
    })
    window.location.search = '?shell=legacy'

    const { result: result1 } = renderHook(() => useChatCenteredShell())
    expect(result1.current.enabled).toBe(false)

    // Config says false, param says chat-centered => true
    vi.mocked(getConfig).mockReturnValue({
      features: { chatCenteredShell: false },
    })
    window.location.search = '?shell=chat-centered'

    const { result: result2 } = renderHook(() => useChatCenteredShell())
    expect(result2.current.enabled).toBe(true)
  })
})
