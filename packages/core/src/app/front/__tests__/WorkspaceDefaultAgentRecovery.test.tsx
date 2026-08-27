// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDefaultAgentRecoveryGate } from '../WorkspaceDefaultAgentRecovery.js'
import type { WorkspaceDefaultAgentState } from '../../../shared/workspaceDefaultAgent.js'

/** Mirrors PROBE_RETRY_LIMIT + the initial attempt in the component. */
const PROBE_ATTEMPTS_BEFORE_GIVING_UP = 3
/** Mirrors PROBE_TIMEOUT_MS in the component. */
const PROBE_TIMEOUT_MS = 10_000

const UNAVAILABLE: WorkspaceDefaultAgentState = {
  workspaceId: 'workspace-a',
  status: 'unavailable',
  persistedDefaultAgentTypeId: 'retired-seat',
  availableAgents: [
    { agentTypeId: 'general', label: 'General' },
    { agentTypeId: 'reviewer', label: 'Reviewer' },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function renderGate(onRecovered?: (id: string) => void) {
  return render(
    <WorkspaceDefaultAgentRecoveryGate
      workspaceId="workspace-a"
      requestHeaders={{ 'x-app': 'test' }}
      onRecovered={onRecovered}
    >
      <div data-testid="workspace-shell">workspace</div>
    </WorkspaceDefaultAgentRecoveryGate>,
  )
}

describe('WorkspaceDefaultAgentRecoveryGate', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { cleanup() })

  it('renders the workspace unchanged when the persisted default resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...UNAVAILABLE, status: 'ok' })))
    renderGate()
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy()
    expect(screen.queryByTestId('workspace-default-agent-recovery')).toBeNull()
  })

  it('names the missing Agent and lists the seats that can replace it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(UNAVAILABLE)))
    renderGate()

    const recovery = await screen.findByTestId('workspace-default-agent-recovery')
    expect(recovery.textContent).toContain('retired-seat')
    expect(screen.queryByTestId('workspace-shell')).toBeNull()
    const options = screen.getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual(['Generalgeneral', 'Reviewerreviewer'])
  })

  it('persists the chosen Agent and clears the recovery state', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT'
        ? jsonResponse({ ...UNAVAILABLE, status: 'ok', persistedDefaultAgentTypeId: 'reviewer' })
        : jsonResponse(UNAVAILABLE)
    ))
    vi.stubGlobal('fetch', fetchMock)
    const onRecovered = vi.fn()
    renderGate(onRecovered)

    await screen.findByTestId('workspace-default-agent-recovery')
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /Reviewer/ }))
    await user.click(screen.getByRole('button', { name: 'Set as default Agent' }))

    await waitFor(() => expect(onRecovered).toHaveBeenCalledWith('reviewer'))
    const write = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(write).toBeDefined()
    expect(JSON.parse((write![1] as RequestInit).body as string)).toEqual({
      expectedDefaultAgentTypeId: 'retired-seat',
      defaultAgentTypeId: 'reviewer',
    })
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy()
  })

  it('degrades honestly when the fleet has no Agent to pin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...UNAVAILABLE, availableAgents: [] })))
    renderGate()

    expect(await screen.findByTestId('workspace-default-agent-recovery-empty')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set as default Agent' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('surfaces a failed write instead of pretending the workspace recovered', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? jsonResponse({}, 500) : jsonResponse(UNAVAILABLE)
    ))
    vi.stubGlobal('fetch', fetchMock)
    renderGate()

    await screen.findByTestId('workspace-default-agent-recovery')
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /General/ }))
    await user.click(screen.getByRole('button', { name: 'Set as default Agent' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByTestId('workspace-shell')).toBeNull()
  })

  it('does not lock the user out when the probe itself cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    renderGate()
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy()
  })

  // Review round 1, finding 3: a broken workspace behind a failing probe used
  // to get children it cannot use and no way to ask again.
  it('offers a re-check after a probe failure and reveals the broken state on retry', async () => {
    vi.useFakeTimers()
    try {
      let probes = 0
      vi.stubGlobal('fetch', vi.fn(async () => {
        probes += 1
        if (probes <= PROBE_ATTEMPTS_BEFORE_GIVING_UP) throw new Error('offline')
        return jsonResponse(UNAVAILABLE)
      }))
      renderGate()

      // Bounded automatic re-probe first; only then the explicit affordance.
      for (let tick = 0; tick < 8; tick += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      }
      expect(probes).toBe(PROBE_ATTEMPTS_BEFORE_GIVING_UP)
      expect(screen.getByTestId('workspace-shell')).toBeTruthy()
      const notice = screen.getByTestId('workspace-default-agent-probe-failed')
      expect(notice).toBeTruthy()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByTestId('workspace-default-agent-recovery')).toBeTruthy()
      expect(screen.queryByTestId('workspace-default-agent-probe-failed')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  // Round 2: a hung connection neither rejects nor resolves, so nothing on the
  // failure path used to run at all and "Check again" was unreachable.
  it('bounds a probe that never settles and still reaches Check again', async () => {
    vi.useFakeTimers()
    try {
      let probes = 0
      const signals: AbortSignal[] = []
      let respondWithBrokenState = false
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        probes += 1
        if (init?.signal) signals.push(init.signal)
        if (respondWithBrokenState) return jsonResponse(UNAVAILABLE)
        // Never settles, and ignores the abort signal the way a wedged
        // connection can: the component must not depend on it rejecting.
        return await new Promise<Response>(() => {})
      }))
      renderGate()

      // Nothing has happened yet — that is the whole bug: no rejection, no
      // response, so no retry and no affordance until the timeout bounds it.
      await act(async () => { await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1) })
      expect(probes).toBe(1)
      expect(screen.queryByTestId('workspace-default-agent-probe-failed')).toBeNull()

      // Each attempt is bounded, and the ladder respects PROBE_RETRY_LIMIT.
      await act(async () => { await vi.advanceTimersByTimeAsync(2) })
      expect(signals[0]?.aborted).toBe(true)
      for (let tick = 0; tick < 40; tick += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      }
      expect(probes).toBe(PROBE_ATTEMPTS_BEFORE_GIVING_UP)
      expect(screen.getByTestId('workspace-shell')).toBeTruthy()
      expect(screen.getByTestId('workspace-default-agent-probe-failed')).toBeTruthy()

      // No further probes once it has given up — the user is in control.
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(probes).toBe(PROBE_ATTEMPTS_BEFORE_GIVING_UP)

      respondWithBrokenState = true
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByTestId('workspace-default-agent-recovery')).toBeTruthy()
      expect(screen.queryByTestId('workspace-default-agent-probe-failed')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('treats a rejected probe response as a failure rather than a healthy workspace', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)))
      renderGate()
      for (let tick = 0; tick < 8; tick += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      }
      expect(screen.getByTestId('workspace-default-agent-probe-failed')).toBeTruthy()
    } finally { vi.useRealTimers() }
  })

  it('re-reads instead of retrying blindly when the server reports a stale repin', async () => {
    let state = UNAVAILABLE
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return jsonResponse(state)
      // Somebody else recovered this workspace between read and confirm.
      state = { ...UNAVAILABLE, status: 'ok', persistedDefaultAgentTypeId: 'general' }
      return jsonResponse({ code: 'default_agent_type_unknown_seat' }, 409)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onRecovered = vi.fn()
    renderGate(onRecovered)

    await screen.findByTestId('workspace-default-agent-recovery')
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /Reviewer/ }))
    await user.click(screen.getByRole('button', { name: 'Set as default Agent' }))

    // No false success, and the surface re-probes rather than insisting on a
    // seat that is no longer the persisted one.
    expect(onRecovered).not.toHaveBeenCalled()
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy()
  })
})
