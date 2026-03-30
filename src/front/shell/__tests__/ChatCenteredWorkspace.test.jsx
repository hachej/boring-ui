import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock child components to isolate workspace shell tests
vi.mock('../ChatStage', () => ({
  default: function MockChatStage() {
    return <div data-testid="chat-stage">ChatStage</div>
  },
}))

vi.mock('../NavRail', () => ({
  default: function MockNavRail({ activeDestination, onDestinationChange }) {
    return (
      <nav data-testid="nav-rail" role="navigation" aria-label="Main navigation">
        <button onClick={() => onDestinationChange('history')}>History</button>
      </nav>
    )
  },
}))

vi.mock('../BrowseDrawer', () => ({
  default: function MockBrowseDrawer({ open }) {
    return open ? <div data-testid="browse-drawer">BrowseDrawer</div> : null
  },
}))

vi.mock('../SurfaceShell', () => ({
  default: function MockSurfaceShell({ open }) {
    return (
      <div
        data-testid="surface-shell"
        style={{ display: open ? 'flex' : 'none' }}
      >
        SurfaceShell
      </div>
    )
  },
}))

vi.mock('../useSessionState', () => ({
  useSessionState: () => ({
    activeSessionId: null,
    sessions: [],
    switchSession: vi.fn(),
    createNewSession: vi.fn(),
    addSession: vi.fn(),
  }),
}))

vi.mock('../useArtifactController', () => ({
  useArtifactController: () => ({
    surfaceOpen: false,
    activeArtifactId: null,
    artifacts: new Map(),
    orderedIds: [],
    open: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    setSurfaceOpen: vi.fn(),
  }),
}))

vi.mock('../useChatMetrics', () => ({
  useChatMetrics: () => ({
    recordEvent: vi.fn(),
    recordLatency: vi.fn(),
    recordError: vi.fn(),
    getMetrics: vi.fn(() => ({ events: [], latencies: [], errors: [] })),
  }),
  ChatMetricsProvider: ({ children }) => <>{children}</>,
  useChatMetricsContext: vi.fn(),
}))

vi.mock('../useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

import ChatCenteredWorkspace from '../ChatCenteredWorkspace'

describe('ChatCenteredWorkspace', () => {
  it('renders without crashing', () => {
    render(<ChatCenteredWorkspace />)
    const workspace = screen.getByTestId('chat-centered-workspace')
    expect(workspace).toBeInTheDocument()
  })

  it('contains a nav rail region (role="navigation")', () => {
    render(<ChatCenteredWorkspace />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })
    expect(nav).toBeInTheDocument()
  })

  it('contains a main chat stage region (role="main")', () => {
    render(<ChatCenteredWorkspace />)
    const main = screen.getByRole('main')
    expect(main).toBeInTheDocument()
  })

  it('does NOT render DockviewReact', () => {
    render(<ChatCenteredWorkspace />)
    expect(screen.queryByTestId('dockview')).not.toBeInTheDocument()
  })

  it('shows chat stage with empty state by default', () => {
    render(<ChatCenteredWorkspace />)
    const chatStage = screen.getByTestId('chat-stage')
    expect(chatStage).toBeInTheDocument()
  })

  it('surface is NOT visible by default (hidden until artifact opens)', () => {
    render(<ChatCenteredWorkspace />)
    const surface = screen.getByTestId('surface-shell')
    expect(surface).toHaveStyle({ display: 'none' })
  })
})
