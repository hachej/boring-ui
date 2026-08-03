// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { RuntimeNotices, type RuntimeNotice } from '../RuntimeNotices'

describe('RuntimeNotices', () => {
  test.each([
    'chat-error',
    'protocol-error',
    'session-navigation-error',
  ])('presents %s as a recoverable chat history error', (id) => {
    const onReloadWorkspace = vi.fn()
    const rawDetails = '<img src=x onerror="alert(1)"> Request failed with 500'

    render(
      <RuntimeNotices
        notices={[{ id, level: 'error', text: rawDetails }]}
        onReloadWorkspace={onReloadWorkspace}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Chat history unavailable')).toBeTruthy()
    expect(within(alert).getByText(/Reload the workspace to try again/)).toBeTruthy()
    const details = within(alert).getByText('Error details').closest('details')
    expect(details?.open).toBe(false)
    expect(within(details as HTMLElement).getByText(rawDetails)).toBeTruthy()
    expect(details?.querySelector('img')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Reload workspace' }))
    expect(onReloadWorkspace).toHaveBeenCalledOnce()
  })

  test('leaves generic errors in their existing raw notice presentation', () => {
    render(
      <RuntimeNotices notices={[{ id: 'generic-error', level: 'error', text: 'A generic failure' }]} />,
    )

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('A generic failure')).toBeTruthy()
    expect(within(alert).queryByText('Chat history unavailable')).toBeNull()
    expect(within(alert).queryByText('Error details')).toBeNull()
    expect(within(alert).queryByRole('button', { name: 'Reload workspace' })).toBeNull()
  })

  test('renders reconnect, protocol, warmup, plugin, and retry notices with stable data attrs', () => {
    const notices: RuntimeNotice[] = [
      { id: 'connection-reconnecting', kind: 'reconnect', level: 'warning', text: 'Reconnecting to the agent session…' },
      { id: 'protocol-error', kind: 'protocol', level: 'error', text: 'Unsupported protocol version', dismissible: true },
      { id: 'warmup-runtime', kind: 'warmup', level: 'info', text: 'Starting runtime…' },
      { id: 'plugin-reload', kind: 'plugin', level: 'info', text: 'Reloading plugins…' },
      { id: 'auto-retry', kind: 'retry', level: 'info', text: 'Retrying agent request (1/3)…' },
    ]

    render(<RuntimeNotices notices={notices} />)

    const group = screen.getByText('Reconnecting to the agent session…').closest('[data-boring-agent-part="runtime-notices"]')
    expect(group).toBeTruthy()
    for (const notice of notices) {
      const row = screen.getByText(notice.text).closest('[data-boring-agent-part="runtime-notice"]')
      expect(row?.getAttribute('data-runtime-notice-id')).toBe(notice.id)
      expect(row?.getAttribute('data-runtime-notice-kind')).toBe(notice.kind)
      expect(row?.getAttribute('data-runtime-notice-level')).toBe(notice.level)
      expect(row?.getAttribute('role')).toBe(notice.level === 'error' ? 'alert' : 'status')
    }
  })

  test('supports retry action and dismissible protocol errors without owning protocol state', () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    render(
      <RuntimeNotices
        notices={[
          { id: 'connection-reconnecting', level: 'warning', text: 'Reconnecting…' },
          { id: 'protocol-error', level: 'error', text: 'Bad protocol', dismissible: true },
        ]}
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    )

    const reconnect = screen.getByText('Reconnecting…').closest('[data-boring-agent-part="runtime-notice"]') as HTMLElement
    fireEvent.click(within(reconnect).getByRole('button', { name: 'Retry now' }))
    expect(onAction).toHaveBeenCalledWith('connection-reconnecting')

    const protocol = screen.getByText('Bad protocol').closest('[data-boring-agent-part="runtime-notice"]') as HTMLElement
    fireEvent.click(within(protocol).getByRole('button', { name: 'Dismiss notice' }))
    expect(onDismiss).toHaveBeenCalledWith('protocol-error')
  })
})
