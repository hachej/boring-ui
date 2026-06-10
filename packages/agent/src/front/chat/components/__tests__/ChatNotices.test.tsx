// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { RuntimeNoticeMessages } from '../ChatNotices'

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
