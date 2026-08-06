// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { RuntimeNotices, type RuntimeNotice } from '../RuntimeNotices'

describe('RuntimeNotices', () => {
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

  test.each(['chat-error', 'protocol-error', 'session-navigation-error'])(
    'gives terminal chat error %s plain-language framing, collapsible details, and a reload action',
    (id) => {
      const reload = vi.fn()
      vi.stubGlobal('location', { ...window.location, reload })

      render(<RuntimeNotices notices={[{ id, level: 'error', text: 'ECONNRESET: socket hang up at fetchSession (remotePiSession.ts:42)' }]} />)

      const row = screen.getByText('Chat history unavailable').closest('[data-boring-agent-part="runtime-notice"]') as HTMLElement
      expect(row).toBeTruthy()
      expect(within(row).getByText(/saved conversation could not be loaded/i)).toBeTruthy()

      // The raw error is demoted to a collapsed technical-details disclosure,
      // not shown as the headline message.
      const details = within(row).getByText('Error details').closest('details') as HTMLDetailsElement
      expect(details).toBeTruthy()
      expect(details.open).toBe(false)
      expect(within(row).getByText(/ECONNRESET/)).toBeTruthy()

      fireEvent.click(within(row).getByRole('button', { name: 'Reload workspace' }))
      expect(reload).toHaveBeenCalledTimes(1)

      vi.unstubAllGlobals()
    },
  )

  test('non-terminal notices keep the raw text as the headline with no reload action', () => {
    render(<RuntimeNotices notices={[{ id: 'connection-reconnecting', level: 'warning', text: 'Reconnecting to the agent session…' }]} />)
    expect(screen.queryByText('Chat history unavailable')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reload workspace' })).toBeNull()
    expect(screen.getByText('Reconnecting to the agent session…')).toBeTruthy()
  })
})
