// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { QueuedComposerNotice, RuntimeNoticeMessages } from '../ChatNotices'

describe('RuntimeNoticeMessages', () => {
  test('formats command failures as readable multiline runtime notices', () => {
    const onDismiss = vi.fn()
    const text = 'Command failed:\nreally-long-unbroken-command-output-token-that-should-wrap'

    render(
      <RuntimeNoticeMessages
        notices={[{ id: 'command:failed', level: 'error', text, dismissible: true }]}
        onDismiss={onDismiss}
      />,
    )

    const row = screen.getByRole('alert')
    expect(row.getAttribute('data-boring-agent-part')).toBe('runtime-notice')
    expect(row.getAttribute('data-runtime-notice-id')).toBe('command:failed')
    expect(row.getAttribute('data-runtime-notice-level')).toBe('error')
    expect(row.closest('[data-boring-agent-message-role]')).toBeNull()

    const body = row.querySelector('.whitespace-pre-wrap') as HTMLElement
    expect(body.textContent).toBe(text)
    expect(body.className).toContain('whitespace-pre-wrap')
    expect(body.className).toContain('break-words')
    expect(body.className).toContain('[overflow-wrap:anywhere]')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }))
    expect(onDismiss).toHaveBeenCalledWith('command:failed')
  })
})

describe('QueuedComposerNotice', () => {
  const followUps = [
    { id: 'q1', kind: 'followup' as const, clientNonce: 'n-1', displayText: 'first held' },
    { id: 'q2', kind: 'followup' as const, clientNonce: 'n-2', displayText: 'second held' },
  ]

  test('renders one remove button per queued message and removes the right one', () => {
    const onRemove = vi.fn()
    render(<QueuedComposerNotice followUps={followUps} onEdit={vi.fn()} onRemove={onRemove} />)

    expect(screen.getByText('2 queued follow-ups')).toBeTruthy()
    const removeButtons = screen.getAllByRole('button', { name: /Remove queued message/ })
    expect(removeButtons).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Remove queued message 1 of 2: first held/ }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(followUps[0])
  })

  test('renders the nudge action that flushes the held queue now', () => {
    const onResume = vi.fn()
    render(<QueuedComposerNotice followUps={followUps} onEdit={vi.fn()} onResume={onResume} />)

    fireEvent.click(screen.getByRole('button', { name: /Nudge agent/ }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  test('hides per-message remove buttons when the surface cannot address single entries', () => {
    render(<QueuedComposerNotice followUps={followUps} onEdit={vi.fn()} />)
    expect(screen.queryAllByRole('button', { name: /Remove queued message/ })).toHaveLength(0)
    // Legacy joined-text preview remains.
    expect(screen.getByText('first held - second held')).toBeTruthy()
  })
})
