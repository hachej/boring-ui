// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

let currentWorkspaceId = 'workspace-a'
let bootGateProps: Record<string, unknown> | null = null
let workspaceAgentProps: Record<string, unknown> | null = null

vi.mock('../../../front/index.js', () => ({
  CoreFront: ({ children }: { children?: ReactNode }) => (
    <MemoryRouter initialEntries={[`/workspace/${currentWorkspaceId}`]}>
      <Routes>{children}</Routes>
    </MemoryRouter>
  ),
  UserMenu: () => <div>User menu</div>,
  WorkspaceSwitcher: () => <div>Switcher</div>,
  useCurrentWorkspace: () => ({ id: currentWorkspaceId, name: 'Workspace A' }),
}))

vi.mock('@hachej/boring-workspace/app/front', () => ({
  WorkspaceBootGate: ({ children, ...props }: { children?: ReactNode }) => {
    bootGateProps = props
    return <div data-testid="boot-gate">{children}</div>
  },
  WorkspaceAgentFront: (props: Record<string, unknown>) => {
    workspaceAgentProps = props
    return <div data-testid="workspace-agent-front">Workspace agent</div>
  },
}))

async function importSubject() {
  return await import('../CoreWorkspaceAgentFront.js')
}

describe('CoreWorkspaceAgentFront', () => {
  beforeEach(() => {
    currentWorkspaceId = 'workspace-a'
    bootGateProps = null
    workspaceAgentProps = null
  })

  it('injects the routed workspace id into boot and workspace request headers', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(
      <CoreWorkspaceAgentFront
        requestHeaders={{ existing: 'request' }}
        authHeaders={{ existing: 'auth' }}
        apiBaseUrl="/api-base"
      />,
    )

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(bootGateProps).toMatchObject({
      workspaceId: 'workspace-a',
      apiBaseUrl: '/api-base',
      requestHeaders: {
        existing: 'request',
        'x-boring-workspace-id': 'workspace-a',
      },
    })
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'workspace-a',
      requestHeaders: {
        existing: 'request',
        'x-boring-workspace-id': 'workspace-a',
      },
      authHeaders: {
        existing: 'auth',
        'x-boring-workspace-id': 'workspace-a',
      },
    })
  })

  it('forces front plugin hot reload off while forwarding workspace props', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(
      <CoreWorkspaceAgentFront
        apiBaseUrl="/api-base"
        defaultSurfaceOpen={false}
        extraPanels={['demo-panel']}
      />,
    )

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps).toMatchObject({
      apiBaseUrl: '/api-base',
      defaultSurfaceOpen: false,
      extraPanels: ['demo-panel'],
      frontPluginHotReload: false,
      hotReloadEnabled: false,
    })
  })

  it('fails fast if core app hot reload is requested', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    expect(() => render(
      <CoreWorkspaceAgentFront
        hotReload={true as false}
      />,
    )).toThrow(/does not support hotReload/)
  })
})
