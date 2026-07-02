// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanyAdminPage } from '../workspace/CompanyAdminPage'

const mockUseCurrentWorkspace = vi.fn()
const mockUseWorkspaceRole = vi.fn()

vi.mock('../WorkspaceAuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../WorkspaceAuthProvider')>('../WorkspaceAuthProvider')
  return {
    ...actual,
    useCurrentWorkspace: () => mockUseCurrentWorkspace(),
    useWorkspaceRole: () => mockUseWorkspaceRole(),
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
})

describe('CompanyAdminPage', () => {
  it('renders owner admin shell with context and model tabs', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Workspace A' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Context access' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Model control' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { name: 'Context access' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Model control' }))

    expect(screen.getByRole('tab', { name: 'Model control' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Model control' })).toBeInTheDocument()
  })

  it('blocks non-owner members in the client shell', () => {
    mockUseWorkspaceRole.mockReturnValue('viewer')

    renderPage()

    expect(screen.getByText('Owner access required')).toBeInTheDocument()
    expect(screen.getByText(/Only workspace owners can manage/)).toBeInTheDocument()
  })
})
