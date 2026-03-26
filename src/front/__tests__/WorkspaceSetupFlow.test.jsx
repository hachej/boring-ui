/**
 * @vitest-environment jsdom
 *
 * Comprehensive workspace setup flow tests.
 * Covers the full create → setup → poll → auto-advance workflow
 * and the exact bugs that were missed by the original tests:
 *
 * 1. Polling transition: pending → ready (not just immediate ready)
 * 2. Setup page stuck when runtime stays pending
 * 3. Auto-advance conditions (runtime ready + capabilities loaded)
 * 4. Retry button behavior when runtime enters error state
 * 5. Error handling during polling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import './setup.ts'
import WorkspaceSetupPage from '../pages/WorkspaceSetupPage'

const mockApiFetchJson = vi.fn()
const mockApiFetch = vi.fn()

vi.mock('../utils/transport', () => ({
  apiFetchJson: (...args) => mockApiFetchJson(...args),
  apiFetch: (...args) => mockApiFetch(...args),
}))

vi.mock('../utils/apiBase', () => ({
  buildApiUrl: (path) => path,
}))

vi.mock('../components/GitHubConnect', () => ({
  useGitHubConnection: () => ({
    status: null,
    loading: false,
    connect: vi.fn(),
  }),
}))

vi.mock('../components/ThemeToggle', () => ({
  default: () => <button data-testid="theme-toggle">Toggle</button>,
}))

// Shared state for controlling mock responses mid-test
let runtimeState = 'ready'
let runtimeRetryable = false
let runtimeError = null
let capabilitiesResponse = { features: { files: true } }
let capabilitiesShouldFail = false
let runtimeCallCount = 0

function setupMocks() {
  runtimeCallCount = 0

  mockApiFetchJson.mockImplementation(async (path) => {
    if (path === '/api/capabilities') {
      if (capabilitiesShouldFail) {
        return {
          response: { ok: false, status: 500 },
          data: { error: 'Internal server error' },
        }
      }
      return {
        response: { ok: true, status: 200 },
        data: capabilitiesResponse,
      }
    }
    if (path === '/api/v1/workspaces/ws-test/runtime') {
      runtimeCallCount++
      return {
        response: { ok: true, status: 200 },
        data: {
          ok: true,
          runtime: {
            workspace_id: 'ws-test',
            state: runtimeState,
            status: runtimeState,
            retryable: runtimeRetryable,
            last_error: runtimeError,
            updated_at: new Date().toISOString(),
          },
        },
      }
    }
    return {
      response: { ok: true, status: 200 },
      data: {},
    }
  })
}

describe('WorkspaceSetupPage flow', () => {
  const originalLocation = window.location

  beforeEach(() => {
    runtimeState = 'ready'
    runtimeRetryable = false
    runtimeError = null
    capabilitiesResponse = { features: { files: true } }
    capabilitiesShouldFail = false

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: '/w/ws-test/setup',
        search: '',
        assign: vi.fn(),
      },
    })

    setupMocks()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  // -----------------------------------------------------------------------
  // 1. Immediate ready — auto-advances without polling
  // -----------------------------------------------------------------------
  it('auto-advances immediately when runtime is already ready', async () => {
    const onComplete = vi.fn()
    runtimeState = 'ready'

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // 2. Pending → Ready transition via polling
  // -----------------------------------------------------------------------
  it('polls runtime endpoint and auto-advances when state transitions to ready', async () => {
    const onComplete = vi.fn()
    runtimeState = 'pending'

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    // Should show "Preparing" UI, not auto-advance
    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThanOrEqual(1)
    })
    expect(onComplete).not.toHaveBeenCalled()

    // Verify the pending state UI is shown
    expect(screen.getByText(/Preparing your workspace/i)).toBeInTheDocument()

    // Transition to ready on next poll
    runtimeState = 'ready'

    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )
  })

  // -----------------------------------------------------------------------
  // 3. Pending stays pending — setup page shows provisioning state
  // -----------------------------------------------------------------------
  it('shows provisioning UI while runtime stays pending', async () => {
    const onComplete = vi.fn()
    runtimeState = 'pending'

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThanOrEqual(1)
    })

    // Should show the preparing UI
    expect(screen.getByText(/Preparing your workspace/i)).toBeInTheDocument()
    // Should NOT auto-advance
    expect(onComplete).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // 4. Error state with retry
  // -----------------------------------------------------------------------
  it('shows retry button when runtime enters error state', async () => {
    const onComplete = vi.fn()
    runtimeState = 'error'
    runtimeRetryable = true
    runtimeError = 'Machine failed to start'

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThanOrEqual(1)
    })

    // Should show retry button
    await waitFor(() => {
      expect(screen.getByText(/Retry setup/i)).toBeInTheDocument()
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // 5. Retry triggers POST and refreshes state
  // -----------------------------------------------------------------------
  it('retry button calls runtime retry endpoint and refreshes', async () => {
    const onComplete = vi.fn()
    runtimeState = 'error'
    runtimeRetryable = true

    mockApiFetch.mockResolvedValue({ ok: true })

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/Retry setup/i)).toBeInTheDocument()
    })

    // Click retry — transition to ready
    runtimeState = 'ready'
    runtimeRetryable = false

    fireEvent.click(screen.getByText(/Retry setup/i))

    // Should call the retry endpoint
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/workspaces/ws-test/runtime/retry',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    // Should auto-advance after retry succeeds
    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )
  })

  // -----------------------------------------------------------------------
  // 6. Runtime endpoint returns 401 → redirects to login
  // -----------------------------------------------------------------------
  it('redirects to login when runtime endpoint returns 401', async () => {
    mockApiFetchJson.mockImplementation(async (path) => {
      if (path === '/api/capabilities') {
        return {
          response: { ok: true, status: 200 },
          data: { features: { files: true } },
        }
      }
      if (path.includes('/runtime')) {
        return {
          response: { ok: false, status: 401 },
          data: {},
        }
      }
      return { response: { ok: true, status: 200 }, data: {} }
    })

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
      />,
    )

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(
        expect.stringContaining('/auth/login'),
      )
    })
  })

  // -----------------------------------------------------------------------
  // 7. Runtime endpoint error → shows error UI
  // -----------------------------------------------------------------------
  it('shows error UI when runtime endpoint fails', async () => {
    mockApiFetchJson.mockImplementation(async (path) => {
      if (path === '/api/capabilities') {
        return {
          response: { ok: true, status: 200 },
          data: { features: { files: true } },
        }
      }
      if (path.includes('/runtime')) {
        return {
          response: { ok: false, status: 500 },
          data: { message: 'Internal server error' },
        }
      }
      return { response: { ok: true, status: 200 }, data: {} }
    })

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/hit a problem/i)).toBeInTheDocument()
    })
  })

  // -----------------------------------------------------------------------
  // 8. Capabilities not loaded — blocks auto-advance even if ready
  // -----------------------------------------------------------------------
  it('does not auto-advance until capabilities are loaded', async () => {
    const onComplete = vi.fn()
    runtimeState = 'ready'
    capabilitiesShouldFail = true

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={true}
        onComplete={onComplete}
      />,
    )

    // Runtime is ready but capabilities are pending — should NOT advance yet
    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThanOrEqual(1)
    })

    // Give it time to potentially auto-advance (it shouldn't)
    await new Promise((r) => setTimeout(r, 500))
    expect(onComplete).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // 9. Provisioning state shows status badge
  // -----------------------------------------------------------------------
  it('shows provisioning status badge during provisioning state', async () => {
    runtimeState = 'provisioning'

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
      />,
    )

    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getByText('Provisioning')).toBeInTheDocument()
  })

  // -----------------------------------------------------------------------
  // 10. Multiple polls happen at 2s interval
  // -----------------------------------------------------------------------
  it('polls runtime endpoint multiple times when state is not ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onComplete = vi.fn()
    runtimeState = 'pending'

    render(
      <WorkspaceSetupPage
        workspaceId="ws-test"
        workspaceName="Test WS"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    // Initial load
    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThanOrEqual(1)
    })

    const countAfterFirstPoll = runtimeCallCount

    // Advance timer past one poll interval (2s)
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })

    // Should have polled again
    await waitFor(() => {
      expect(runtimeCallCount).toBeGreaterThan(countAfterFirstPoll)
    })

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// Server-side: verify runtime response matches frontend expectations
// ---------------------------------------------------------------------------
describe('Runtime response shape contract', () => {
  it('getRuntimeStatus extracts state from nested runtime payload', async () => {
    const { getRuntimeStatus, isRuntimeReady } = await import('../utils/controlPlane')

    // Shape returned by TS backend: { ok: true, runtime: { state: 'ready' } }
    const tsBackendResponse = { ok: true, runtime: { state: 'ready' } }
    expect(getRuntimeStatus(tsBackendResponse)).toBe('ready')
    expect(isRuntimeReady(tsBackendResponse)).toBe(true)

    // WorkspaceSetupPage extracts: setupPayload?.runtime
    const runtimePayload = tsBackendResponse.runtime
    expect(getRuntimeStatus(runtimePayload)).toBe('ready')
    expect(isRuntimeReady(runtimePayload)).toBe(true)
  })

  it('identifies pending state as NOT ready', async () => {
    const { isRuntimeReady, getRuntimeStatus } = await import('../utils/controlPlane')

    expect(isRuntimeReady({ state: 'pending' })).toBe(false)
    expect(getRuntimeStatus({ state: 'pending' })).toBe('pending')
  })

  it('identifies provisioning state as NOT ready', async () => {
    const { isRuntimeReady } = await import('../utils/controlPlane')

    expect(isRuntimeReady({ state: 'provisioning' })).toBe(false)
  })

  it('identifies error state as NOT ready', async () => {
    const { isRuntimeReady, shouldRetryRuntime } = await import('../utils/controlPlane')

    expect(isRuntimeReady({ state: 'error' })).toBe(false)
    expect(shouldRetryRuntime({ state: 'error' })).toBe(true)
  })

  it('identifies running/active as ready (for backwards compatibility)', async () => {
    const { isRuntimeReady } = await import('../utils/controlPlane')

    expect(isRuntimeReady({ state: 'running' })).toBe(true)
    expect(isRuntimeReady({ state: 'active' })).toBe(true)
  })
})
