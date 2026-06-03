// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { SessionSummary } from '../../../../shared/session'
import { SessionList } from '../SessionList'

const now = new Date('2026-06-03T12:00:00.000Z')
const sessions: SessionSummary[] = [
  { id: 'pi-1', title: 'Running session', createdAt: now.toISOString(), updatedAt: now.toISOString(), turnCount: 1 },
  { id: 'pi-2', title: 'Older session', createdAt: new Date(now.getTime() - 90_000).toISOString(), updatedAt: new Date(now.getTime() - 90_000).toISOString(), turnCount: 0 },
]

describe('SessionList', () => {
  test('renders sessions with agent-owned data attrs and active state', () => {
    render(<SessionList sessions={sessions} activeId="pi-1" />)

    expect(screen.getByRole('navigation', { name: 'Session history' })).toHaveAttribute('data-boring-agent-part', 'session-list')
    expect(screen.getByText('Running session')).toBeInTheDocument()
    expect(screen.getByText('Older session')).toBeInTheDocument()
    expect(screen.getByText('Running session').closest('[data-boring-agent-part="session-row"]')).toHaveAttribute('data-boring-state', 'selected')
  })

  test('calls create, switch, and delete without delete also switching', () => {
    const onCreate = vi.fn()
    const onSwitch = vi.fn()
    const onDelete = vi.fn()
    render(<SessionList sessions={sessions} activeId="pi-1" onCreate={onCreate} onSwitch={onSwitch} onDelete={onDelete} />)

    fireEvent.click(screen.getByLabelText('New session'))
    expect(onCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Older session'))
    expect(onSwitch).toHaveBeenCalledWith('pi-2')

    onSwitch.mockClear()
    fireEvent.click(screen.getByLabelText('Delete Older session'))
    expect(onDelete).toHaveBeenCalledWith('pi-2')
    expect(onSwitch).not.toHaveBeenCalled()
  })

  test('renders empty/loading states', () => {
    const { rerender } = render(<SessionList sessions={[]} />)
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument()

    rerender(<SessionList sessions={[]} loading />)
    expect(screen.getByRole('navigation', { name: 'Session history' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText(/Loading sessions/)).toBeInTheDocument()
  })
})
