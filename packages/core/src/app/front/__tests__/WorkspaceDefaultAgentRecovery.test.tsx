// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDefaultAgentRecovery } from '../WorkspaceDefaultAgentRecovery.js'
import type { WorkspaceDefaultAgentState } from '../../../shared/workspaceDefaultAgent.js'

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

function renderRecovery(onRecovered?: (id: string) => void) {
  return render(
    <WorkspaceDefaultAgentRecovery
      workspaceId="workspace-a"
      requestHeaders={{ 'x-app': 'test' }}
      onRecovered={onRecovered}
    />,
  )
}

describe('WorkspaceDefaultAgentRecovery', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { cleanup() })

  it('names the missing Agent and lists the seats that can replace it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(UNAVAILABLE)))
    renderRecovery()

    const recovery = await screen.findByTestId('workspace-default-agent-recovery')
    expect(recovery.textContent).toContain('retired-seat')
    const options = screen.getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual(['Generalgeneral', 'Reviewerreviewer'])
  })

  it('persists the chosen Agent and reports the recovery', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT'
        ? jsonResponse({ ...UNAVAILABLE, status: 'ok', persistedDefaultAgentTypeId: 'reviewer' })
        : jsonResponse(UNAVAILABLE)
    ))
    vi.stubGlobal('fetch', fetchMock)
    const onRecovered = vi.fn()
    renderRecovery(onRecovered)

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
  })

  it('degrades honestly when the fleet has no Agent to pin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...UNAVAILABLE, availableAgents: [] })))
    renderRecovery()

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
    const onRecovered = vi.fn()
    renderRecovery(onRecovered)

    await screen.findByTestId('workspace-default-agent-recovery')
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /General/ }))
    await user.click(screen.getByRole('button', { name: 'Set as default Agent' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('re-reads instead of retrying blindly when the server reports a stale repin', async () => {
    let state: WorkspaceDefaultAgentState = UNAVAILABLE
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return jsonResponse(state)
      // Somebody else recovered this workspace between read and confirm.
      state = { ...UNAVAILABLE, status: 'ok', persistedDefaultAgentTypeId: 'general' }
      return jsonResponse({ code: 'default_agent_type_unknown_seat' }, 409)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onRecovered = vi.fn()
    renderRecovery(onRecovered)

    await screen.findByTestId('workspace-default-agent-recovery')
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /Reviewer/ }))
    await user.click(screen.getByRole('button', { name: 'Set as default Agent' }))

    // No false success, and it re-reads rather than insisting on a seat that is
    // no longer the persisted one.
    expect(onRecovered).not.toHaveBeenCalled()
    await waitFor(() => expect(
      fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'PUT'),
    ).toHaveLength(2))
  })

  it('stays honest when the Agent list itself cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)))
    renderRecovery()

    // The workspace is known-broken (that is why this mounted), so there is no
    // pretending it is fine — but the read is retryable.
    expect(await screen.findByTestId('workspace-default-agent-recovery-unreachable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
