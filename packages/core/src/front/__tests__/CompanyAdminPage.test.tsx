// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanyAdminProvider, type CompanyAdminStatus } from '../CompanyAdminProvider'
import { CompanyAdminPage } from '../workspace/CompanyAdminPage'

const mockUseCurrentWorkspace = vi.fn()
const mockUseWorkspaceRouteStatus = vi.fn()

const renderEmptyAdminContent = () => null

vi.mock('../WorkspaceAuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../WorkspaceAuthProvider')>('../WorkspaceAuthProvider')
  return {
    ...actual,
    useCurrentWorkspace: () => mockUseCurrentWorkspace(),
    useWorkspaceRouteStatus: () => mockUseWorkspaceRouteStatus(),
  }
})

function renderPage(path = '/w/ws-a/admin', wrapper?: (children: ReactNode) => ReactNode) {
  const page = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div data-testid="home-page">Home</div>} />
        <Route path="/w/:id/admin" element={<CompanyAdminPage />} />
      </Routes>
    </MemoryRouter>
  )
  return render(wrapper ? <>{wrapper(page)}</> : page)
}

beforeEach(() => {
  mockUseCurrentWorkspace.mockReturnValue({ id: 'ws-a', name: 'Workspace A' })
  mockUseWorkspaceRouteStatus.mockReturnValue({
    status: 'matched',
    workspaceId: 'ws-a',
    workspace: { id: 'ws-a', name: 'Workspace A' },
  })
})

describe('CompanyAdminPage', () => {
  it('redirects away when no provider is configured', async () => {
    renderPage()

    expect(await screen.findByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByText('Loading admin status…')).toBeNull()
  })

  it('renders app-owned content for provider admins through the generic seam', async () => {
    const status: CompanyAdminStatus = { enabled: true, role: 'admin', admin: true, details: { source: 'test' } }

    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider
        loadStatus={async () => status}
        renderContent={(resolved) => <div>App-owned admin content: {(resolved.details as { source: string }).source}</div>}
      >
        {children}
      </CompanyAdminProvider>
    ))

    expect(await screen.findByText('App-owned admin content: test')).toBeInTheDocument()
  })

  it('redirects away when the provider reports the surface is disabled', async () => {
    const status: CompanyAdminStatus = { enabled: false, role: 'admin', admin: true }

    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider loadStatus={async () => status} renderContent={renderEmptyAdminContent}>{children}</CompanyAdminProvider>
    ))

    expect(await screen.findByTestId('home-page')).toBeInTheDocument()
  })

  it('shows the provider error view when status loading fails', async () => {
    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider
        loadStatus={async () => { throw new Error('Status check failed') }}
        renderContent={renderEmptyAdminContent}
        labels={{ pageTitle: 'Team Admin' }}
      >
        {children}
      </CompanyAdminProvider>
    ))

    expect(await screen.findByText('Admin unavailable')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Team Admin' })).toBeInTheDocument()
    expect(screen.getByText('Status check failed')).toBeInTheDocument()
  })

  it('blocks provider non-admin users with default labels', async () => {
    const status: CompanyAdminStatus = { enabled: true, role: 'user', admin: false }

    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider loadStatus={async () => status} renderContent={renderEmptyAdminContent}>{children}</CompanyAdminProvider>
    ))

    expect(await screen.findByText('Access required')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByText('You do not have access to this page.')).toBeInTheDocument()
  })

  it('uses provider labels in the denied state', async () => {
    const status: CompanyAdminStatus = { enabled: true, role: 'user', admin: false }

    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider
        loadStatus={async () => status}
        renderContent={renderEmptyAdminContent}
        labels={{ pageTitle: 'Team Admin', deniedMessage: 'Ask your team owner for access.' }}
      >
        {children}
      </CompanyAdminProvider>
    ))

    expect(await screen.findByRole('heading', { name: 'Team Admin' })).toBeInTheDocument()
    expect(screen.getByText('Ask your team owner for access.')).toBeInTheDocument()
  })

  it('shows loading state while workspace route status is resolving', () => {
    mockUseWorkspaceRouteStatus.mockReturnValue({ status: 'loading', workspaceId: 'ws-a' })

    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider
        loadStatus={async () => new Promise<CompanyAdminStatus | null>(() => {})}
        renderContent={renderEmptyAdminContent}
      >
        {children}
      </CompanyAdminProvider>
    ))

    expect(screen.getByText('Loading admin…')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).toBeNull()
  })

  it('shows route errors after a provider enables the surface', async () => {
    mockUseWorkspaceRouteStatus.mockReturnValue({
      status: 'not-found',
      workspaceId: 'missing-ws',
      message: 'Workspace not found',
    })
    const status: CompanyAdminStatus = { enabled: true, role: 'admin', admin: true }

    renderPage('/w/missing-ws/admin', (children) => (
      <CompanyAdminProvider loadStatus={async () => status} renderContent={renderEmptyAdminContent} labels={{ pageTitle: 'Team Admin' }}>
        {children}
      </CompanyAdminProvider>
    ))

    expect(await screen.findByText('Workspace unavailable')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Team Admin' })).toBeInTheDocument()
    expect(screen.getByText('Workspace not found')).toBeInTheDocument()
  })

  it('shows forbidden route errors as generic access denial', async () => {
    mockUseWorkspaceRouteStatus.mockReturnValue({
      status: 'forbidden',
      workspaceId: 'ws-a',
      message: 'Forbidden',
    })
    const status: CompanyAdminStatus = { enabled: true, role: 'admin', admin: true }

    renderPage('/w/ws-a/admin', (children) => (
      <CompanyAdminProvider
        loadStatus={async () => status}
        renderContent={renderEmptyAdminContent}
        labels={{ pageTitle: 'Team Admin', deniedMessage: 'You do not have access to this admin surface.' }}
      >
        {children}
      </CompanyAdminProvider>
    ))

    expect(await screen.findByText('Access required')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Team Admin' })).toBeInTheDocument()
    expect(screen.getByText('You do not have access to this admin surface.')).toBeInTheDocument()
  })
})
