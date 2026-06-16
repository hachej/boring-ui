// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { RuntimeConfig } from '../../shared/types'

const mockApiFetchJson = vi.fn()
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    apiFetchJson: (...args: unknown[]) => mockApiFetchJson(...args),
  }
})

import { ConfigProvider, useConfig, useConfigLoaded } from '../ConfigProvider'
import { AppErrorBoundary } from '../AppErrorBoundary'

const VALID_CONFIG: RuntimeConfig = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  apiBase: 'http://localhost:3000',
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, emailVerification: false },
}

const FAST_BACKOFF = [0, 0, 0]

beforeEach(() => {
  vi.clearAllMocks()
})

function BoundaryWrapper({ children }: { children: ReactNode }) {
  return <AppErrorBoundary>{children}</AppErrorBoundary>
}

describe('ConfigProvider', () => {
  it('fetches config on mount and provides it via useConfig', async () => {
    mockApiFetchJson.mockResolvedValue(VALID_CONFIG)

    function TestChild() {
      const config = useConfig()
      return <div data-testid="appId">{config.appId}</div>
    }

    await act(async () => {
      render(
        <BoundaryWrapper>
          <ConfigProvider retryBackoff={FAST_BACKOFF}>
            <TestChild />
          </ConfigProvider>
        </BoundaryWrapper>,
      )
    })

    expect(screen.getByTestId('appId')).toHaveTextContent('test-app')
    expect(mockApiFetchJson).toHaveBeenCalledTimes(1)
    expect(mockApiFetchJson).toHaveBeenCalledWith('/api/v1/config')
  })

  it('useConfigLoaded returns true after load', async () => {
    mockApiFetchJson.mockResolvedValue(VALID_CONFIG)

    function TestChild() {
      const loaded = useConfigLoaded()
      return <div data-testid="loaded">{String(loaded)}</div>
    }

    await act(async () => {
      render(
        <BoundaryWrapper>
          <ConfigProvider retryBackoff={FAST_BACKOFF}>
            <TestChild />
          </ConfigProvider>
        </BoundaryWrapper>,
      )
    })

    expect(screen.getByTestId('loaded')).toHaveTextContent('true')
  })

  it('retries on failure and succeeds on third attempt', async () => {
    mockApiFetchJson
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce(VALID_CONFIG)

    function TestChild() {
      const config = useConfig()
      return <div data-testid="appName">{config.appName}</div>
    }

    await act(async () => {
      render(
        <BoundaryWrapper>
          <ConfigProvider retryBackoff={FAST_BACKOFF}>
            <TestChild />
          </ConfigProvider>
        </BoundaryWrapper>,
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('appName')).toHaveTextContent('Test App')
    })

    expect(mockApiFetchJson).toHaveBeenCalledTimes(3)
  })

  it('throws ConfigFetchError to AppErrorBoundary after all retries fail', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockApiFetchJson.mockRejectedValue(new Error('server down'))

    await act(async () => {
      render(
        <BoundaryWrapper>
          <ConfigProvider retryBackoff={FAST_BACKOFF}>
            <div>should not render</div>
          </ConfigProvider>
        </BoundaryWrapper>,
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Cannot reach server')).toBeInTheDocument()
    })

    expect(screen.getByText(/server down/)).toBeInTheDocument()
    expect(mockApiFetchJson).toHaveBeenCalledTimes(4) // 1 initial + 3 retries

    consoleSpy.mockRestore()
  })

  it('preserves requestId from HttpError in ConfigFetchError', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const httpError = Object.assign(new Error('Server error'), {
      requestId: 'req-abc-123',
    })
    mockApiFetchJson.mockRejectedValue(httpError)

    await act(async () => {
      render(
        <BoundaryWrapper>
          <ConfigProvider retryBackoff={FAST_BACKOFF}>
            <div>should not render</div>
          </ConfigProvider>
        </BoundaryWrapper>,
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Cannot reach server')).toBeInTheDocument()
    })

    expect(screen.getByText(/req-abc-123/)).toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('does not render children while loading', async () => {
    let resolve: (v: RuntimeConfig) => void
    mockApiFetchJson.mockReturnValue(
      new Promise<RuntimeConfig>((r) => { resolve = r }),
    )

    const renderSpy = vi.fn()
    function TestChild() {
      renderSpy()
      return <div>loaded</div>
    }

    await act(async () => {
      render(
        <ConfigProvider retryBackoff={FAST_BACKOFF}>
          <TestChild />
        </ConfigProvider>,
      )
    })

    expect(renderSpy).not.toHaveBeenCalled()

    await act(async () => { resolve!(VALID_CONFIG) })
  })
})

describe('useConfig outside provider', () => {
  it('throws when used outside ConfigProvider', () => {
    expect(() => {
      renderHook(() => useConfig())
    }).toThrow('useConfig must be used within a ConfigProvider')
  })
})
