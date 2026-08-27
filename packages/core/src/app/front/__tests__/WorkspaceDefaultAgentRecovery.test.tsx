// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDefaultAgentRecoveryGate } from '../WorkspaceDefaultAgentRecovery.js'
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

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response
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
    expect(JSON.parse((write![1] as RequestInit).body as string)).toEqual({ defaultAgentTypeId: 'reviewer' })
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
      init?.method === 'PUT' ? jsonResponse({}, false) : jsonResponse(UNAVAILABLE)
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
})
