// @vitest-environment jsdom
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

    expect(screen.getByRole('navigation', { name: 'Session history' }).getAttribute('data-boring-agent-part')).toBe('session-list')
    expect(screen.getByText('Running session')).toBeTruthy()
    expect(screen.getByText('Older session')).toBeTruthy()
    expect(screen.getByText('Running session').closest('[data-boring-agent-part="session-row"]')?.getAttribute('data-boring-state')).toBe('selected')
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

  test('sorts sessions by updatedAt descending with deterministic ties', () => {
    const tiedUpdatedAt = new Date(now.getTime() - 30_000).toISOString()
    const unsorted: SessionSummary[] = [
      { id: 'session-old', title: 'Oldest', createdAt: new Date(now.getTime() - 120_000).toISOString(), updatedAt: new Date(now.getTime() - 120_000).toISOString(), turnCount: 1 },
      { id: 'session-tie-b', title: 'Tie B', createdAt: new Date(now.getTime() - 20_000).toISOString(), updatedAt: tiedUpdatedAt, turnCount: 2 },
      { id: 'session-new', title: 'Newest', createdAt: now.toISOString(), updatedAt: now.toISOString(), turnCount: 3 },
      { id: 'session-tie-a', title: 'Tie A', createdAt: new Date(now.getTime() - 10_000).toISOString(), updatedAt: tiedUpdatedAt, turnCount: 4 },
    ]

    render(<SessionList sessions={unsorted} activeId="session-tie-a" />)

    const rows = Array.from(document.querySelectorAll('[data-boring-agent-part="session-row"]'))
    expect(rows.map((row) => row.querySelector('[title]')?.getAttribute('title'))).toEqual(['Newest', 'Tie A', 'Tie B', 'Oldest'])
    expect(rows.filter((row) => row.getAttribute('data-boring-state') === 'selected')).toHaveLength(1)
    expect(rows[1]?.getAttribute('data-boring-state')).toBe('selected')
  })

  test('conveys live session status on the row, and stays silent when idle', () => {
    const base = { createdAt: now.toISOString(), updatedAt: now.toISOString(), turnCount: 1 }
    const withStatus: SessionSummary[] = [
      { id: 'run', title: 'Running one', ...base, status: 'running' },
      { id: 'stop', title: 'Stopping one', ...base, status: 'aborting' },
      { id: 'bad', title: 'Failed one', ...base, status: 'error' },
      { id: 'calm', title: 'Idle one', ...base, status: 'idle' },
      { id: 'none', title: 'Unknown one', ...base },
    ]

    render(<SessionList sessions={withStatus} />)

    const statusFor = (title: string) => screen
      .getByText(title)
      .closest('[data-boring-agent-part="session-row"]')
      ?.querySelector('[data-boring-agent-part="session-row-status"]')

    expect(statusFor('Running one')?.getAttribute('data-boring-state')).toBe('running')
    expect(statusFor('Running one')?.textContent).toBe('Running')
    expect(statusFor('Stopping one')?.getAttribute('data-boring-state')).toBe('aborting')
    expect(statusFor('Stopping one')?.textContent).toBe('Stopping')
    expect(statusFor('Failed one')?.getAttribute('data-boring-state')).toBe('error')
    expect(statusFor('Failed one')?.textContent).toBe('Failed')

    // Idle is the resting state of nearly every row: it must add no chrome.
    expect(statusFor('Idle one')).toBeNull()
    expect(statusFor('Unknown one')).toBeNull()
  })

  test('renders empty/loading states', () => {
    const { rerender } = render(<SessionList sessions={[]} />)
    expect(screen.getByText(/No sessions yet/)).toBeTruthy()

    rerender(<SessionList sessions={[]} loading />)
    expect(screen.getByRole('navigation', { name: 'Session history' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText(/Loading sessions/)).toBeTruthy()
  })

  test('renders load more control for paginated session history', () => {
    const onLoadMore = vi.fn()
    render(<SessionList sessions={sessions} activeId="pi-1" hasMore onLoadMore={onLoadMore} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
