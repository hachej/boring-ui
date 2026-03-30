import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BrowseDrawer from '../BrowseDrawer'

const now = Date.now()
const oneDayMs = 86400000

const mockSessions = [
  { id: 's1', title: 'Revenue Analysis', lastModified: now - 1000, status: 'active' },
  { id: 's2', title: 'Bug Investigation', lastModified: now - 2000, status: 'idle' },
  { id: 's3', title: 'Old Research', lastModified: now - oneDayMs - 1000, status: 'paused' },
]

describe('BrowseDrawer', () => {
  it('when open=false, not visible (renders null)', () => {
    const { container } = render(
      <BrowseDrawer
        open={false}
        mode="sessions"
        sessions={mockSessions}
        onSwitchSession={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('when open=true with mode="sessions", shows session list', () => {
    render(
      <BrowseDrawer
        open={true}
        mode="sessions"
        sessions={mockSessions}
        onSwitchSession={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const drawer = screen.getByTestId('browse-drawer')
    expect(drawer).toBeInTheDocument()
    expect(screen.getByText('Revenue Analysis')).toBeInTheDocument()
    expect(screen.getByText('Bug Investigation')).toBeInTheDocument()
  })

  it('clicking a session calls onSwitchSession', () => {
    const onSwitch = vi.fn()
    render(
      <BrowseDrawer
        open={true}
        mode="sessions"
        sessions={mockSessions}
        onSwitchSession={onSwitch}
        onClose={vi.fn()}
      />
    )
    const sessionBtn = screen.getByTestId('browse-drawer-session-s1')
    fireEvent.click(sessionBtn)
    expect(onSwitch).toHaveBeenCalledWith('s1')
  })

  it('shows "Today" / "Yesterday" grouping', () => {
    render(
      <BrowseDrawer
        open={true}
        mode="sessions"
        sessions={mockSessions}
        onSwitchSession={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // Today's sessions should be grouped under "Today"
    const todayLabel = screen.getByTestId('browse-drawer-date-today')
    expect(todayLabel).toBeInTheDocument()
    expect(todayLabel).toHaveTextContent('Today')

    // Yesterday's session should be grouped under "Yesterday"
    const yesterdayLabel = screen.getByTestId('browse-drawer-date-yesterday')
    expect(yesterdayLabel).toBeInTheDocument()
    expect(yesterdayLabel).toHaveTextContent('Yesterday')
  })

  it('shows empty state when no sessions', () => {
    render(
      <BrowseDrawer
        open={true}
        mode="sessions"
        sessions={[]}
        onSwitchSession={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
  })

  it('shows workspace placeholder when mode="workspace"', () => {
    render(
      <BrowseDrawer
        open={true}
        mode="workspace"
        sessions={[]}
        onSwitchSession={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Files, Search, Git, Data')).toBeInTheDocument()
  })
})
