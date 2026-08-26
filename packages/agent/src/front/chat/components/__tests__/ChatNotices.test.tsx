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

  test('renders one explicit action that removes the whole queue', () => {
    const onRemove = vi.fn()
    render(<QueuedComposerNotice followUps={followUps} onEdit={vi.fn()} onRemove={onRemove} />)

    expect(screen.getByText('2 queued follow-ups')).toBeTruthy()
    const remove = screen.getByRole('button', { name: 'Remove all queued messages' })
    expect(remove.querySelector('svg')).toBeTruthy()

    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  test('renders the nudge action that flushes the held queue now', () => {
    const onResume = vi.fn()
    render(<QueuedComposerNotice followUps={followUps} onEdit={vi.fn()} onResume={onResume} />)

    const sendNow = screen.getByRole('button', { name: /Nudge agent/ })
    expect(sendNow.textContent).toContain('Send now')
    fireEvent.click(sendNow)
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Edit queued follow-ups' }).textContent).toContain('Edit')
  })

  test('disables every destructive action while a queue mutation is pending', () => {
    render(
      <QueuedComposerNotice
        followUps={followUps}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onResume={vi.fn()}
        actionPending
      />,
    )

    expect((screen.getByRole('button', { name: 'Remove all queued messages' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Nudge agent/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Edit queued follow-ups' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('disables Remove and Edit while Send-now is pending', () => {
    render(
      <QueuedComposerNotice
        followUps={followUps}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onResume={vi.fn()}
        resumePending
      />,
    )

    expect((screen.getByRole('button', { name: 'Remove all queued messages' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Edit queued follow-ups' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('hides per-message remove buttons when the surface cannot address single entries', () => {
    render(<QueuedComposerNotice followUps={followUps} onEdit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Remove all queued messages' })).toBeNull()
    // Legacy joined-text preview remains.
    expect(screen.getByText('first held - second held')).toBeTruthy()
  })
})
