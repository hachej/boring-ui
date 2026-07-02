// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanyAdminPage } from '../workspace/CompanyAdminPage'

const mockUseCurrentWorkspace = vi.fn()
const mockUseWorkspaceRole = vi.fn()
const mockUseWorkspaceRouteStatus = vi.fn()

vi.mock('../WorkspaceAuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../WorkspaceAuthProvider')>('../WorkspaceAuthProvider')
  return {
    ...actual,
    useCurrentWorkspace: () => mockUseCurrentWorkspace(),
    useWorkspaceRole: () => mockUseWorkspaceRole(),
    useWorkspaceRouteStatus: () => mockUseWorkspaceRouteStatus(),
  }
})

function renderPage(path = '/w/ws-a/admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:id/admin" element={<CompanyAdminPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseCurrentWorkspace.mockReturnValue({ id: 'ws-a', name: 'Workspace A' })
  mockUseWorkspaceRole.mockReturnValue('owner')
  mockUseWorkspaceRouteStatus.mockReturnValue({
    status: 'matched',
    workspaceId: 'ws-a',
    workspace: { id: 'ws-a', name: 'Workspace A' },
  })
})

describe('CompanyAdminPage', () => {
  it('renders owner admin shell with context and model tabs', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('heading', { name: 'Workspace A' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Context access' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Model control' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { name: 'Context access' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Model control' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Model control' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByRole('heading', { name: 'Model control' })).toBeInTheDocument()
  })

  it('shows loading state while workspace role is resolving', () => {
    mockUseWorkspaceRole.mockReturnValue(null)
    mockUseWorkspaceRouteStatus.mockReturnValue({ status: 'loading', workspaceId: 'ws-a' })

    renderPage()

    expect(screen.getByText('Loading company admin…')).toBeInTheDocument()
    expect(screen.queryByText('Owner access required')).toBeNull()
  })

  it('shows not-found route errors instead of hanging on loading', () => {
    mockUseWorkspaceRole.mockReturnValue(null)
    mockUseWorkspaceRouteStatus.mockReturnValue({
      status: 'not-found',
      workspaceId: 'missing-ws',
      message: 'Workspace not found',
    })

    renderPage('/w/missing-ws/admin')

    expect(screen.getByText('Workspace unavailable')).toBeInTheDocument()
    expect(screen.getByText('Workspace not found')).toBeInTheDocument()
    expect(screen.queryByText('Loading company admin…')).toBeNull()
  })

  it('shows forbidden route errors instead of hanging on loading', () => {
    mockUseWorkspaceRole.mockReturnValue(null)
    mockUseWorkspaceRouteStatus.mockReturnValue({
      status: 'forbidden',
      workspaceId: 'ws-a',
      message: 'Forbidden',
    })

    renderPage()

    expect(screen.getByText('Owner access required')).toBeInTheDocument()
    expect(screen.getByText(/Only workspace owners can manage/)).toBeInTheDocument()
    expect(screen.queryByText('Loading company admin…')).toBeNull()
  })

  it('blocks non-owner members in the client shell', () => {
    mockUseWorkspaceRole.mockReturnValue('viewer')

    renderPage()

    expect(screen.getByText('Owner access required')).toBeInTheDocument()
    expect(screen.getByText(/Only workspace owners can manage/)).toBeInTheDocument()
  })
})
