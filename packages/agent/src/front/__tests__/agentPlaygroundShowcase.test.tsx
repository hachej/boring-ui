// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@hachej/boring-agent/front', async () => {
  return vi.importActual('../index')
})

import { Showcase } from '../../../../../apps/agent-playground/src/Showcase'

describe('agent playground showcase', () => {
  test('keeps a static chat fixture covering core message and tool states', async () => {
    render(<Showcase />)

    expect(screen.getByRole('heading', { name: 'Chat UX Showcase' })).toBeTruthy()
    expect(screen.getByText('Static showcase - no agent needed')).toBeTruthy()

    const showcase = document.querySelector('[data-boring-agent-part="message-showcase"]')
    expect(showcase).toBeTruthy()
    expect(within(showcase as HTMLElement).getByText('Hard-coded chat session')).toBeTruthy()

    const messageIds = Array.from(showcase!.querySelectorAll('[data-boring-agent-message-id]'))
      .map((node) => node.getAttribute('data-boring-agent-message-id'))
    expect(messageIds).toEqual([
      'showcase-system',
      'showcase-user',
      'showcase-assistant-streaming',
      'showcase-assistant-final',
      'showcase-assistant-error',
      'showcase-assistant-aborted',
    ])

    const roles = Array.from(showcase!.querySelectorAll('[data-boring-agent-message-role]'))
      .map((node) => node.getAttribute('data-boring-agent-message-role'))
    expect(roles).toEqual(['system', 'user', 'assistant', 'assistant', 'assistant', 'assistant'])

    const statuses = Array.from(showcase!.querySelectorAll('[data-boring-agent-message-status]'))
      .map((node) => node.getAttribute('data-boring-agent-message-status'))
    expect(statuses).toEqual(['done', 'done', 'streaming', 'done', 'error', 'aborted'])

    const toolStates = Array.from(showcase!.querySelectorAll('[data-boring-agent-tool-state]'))
      .map((node) => node.getAttribute('data-boring-agent-tool-state'))
    expect(toolStates).toEqual(expect.arrayContaining(['running', 'settled', 'failed', 'aborted']))
    expect(within(showcase as HTMLElement).getByText('Stopped command')).toBeTruthy()
    expect(within(showcase as HTMLElement).getByText('Tool states')).toBeTruthy()
    expect(within(showcase as HTMLElement).getByText('running, used, stopped, failed')).toBeTruthy()

    expect(within(showcase as HTMLElement).getByText('1 queued follow-up')).toBeTruthy()
    expect(within(showcase as HTMLElement).getByText('After you finish, run the browser baseline too.')).toBeTruthy()
    expect(showcase!.querySelector('[data-boring-agent-part="composer-queue-preview"]')).toBeTruthy()
    expect(showcase!.querySelector('[data-boring-agent-part="message-notice"]')).toBeTruthy()
    expect(showcase!.querySelector('[data-boring-agent-part="message-file"]')).toBeTruthy()

    const filenames = await within(showcase as HTMLElement).findAllByText('README.md')
    expect(filenames.some((node) => node.tagName === 'CODE' && node.className.includes('bg-muted/55'))).toBe(true)
  })
})
