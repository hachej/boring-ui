// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSlashCommandMarkdownComponents } from '../../chat/components/SlashCommandMentions'
import { MessageResponse } from '../message'

const reload = [{ name: 'reload', clickBehavior: 'execute' as const }]

describe('MessageResponse slash command components', () => {
  it('decorates prose, headings, and inline code without touching links or fenced code', async () => {
    const onActivate = vi.fn()
    const components = createSlashCommandMarkdownComponents(reload, onActivate)
    render(
      <MessageResponse components={components}>{[
        'Please run /reload.',
        '',
        '# Then `/reload`',
        '',
        'Keep [/reload](https://example.test) and fenced code inert:',
        '',
        '```text',
        '/reload',
        '```',
      ].join('\n')}</MessageResponse>,
    )

    const buttons = await screen.findAllByRole('button', { name: 'Run /reload command' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0])
    expect(onActivate).toHaveBeenCalledWith('reload')
    expect(screen.getByRole('button', { name: '/reload' })).toBeTruthy()
    expect(document.querySelector('pre code')?.textContent).toBe('/reload')
    expect(document.querySelector('pre button')).toBeNull()
  })

  it('remounts without stale actions when command actionability changes', async () => {
    const onActivate = vi.fn()
    const components = createSlashCommandMarkdownComponents(reload, onActivate)
    const { rerender } = render(
      <MessageResponse key="reload:enabled" components={components}>Run /reload.</MessageResponse>,
    )
    expect(await screen.findByRole('button', { name: 'Run /reload command' })).toBeTruthy()

    rerender(<MessageResponse key="no-slash-commands:static">Run /reload.</MessageResponse>)
    expect(screen.queryByRole('button', { name: 'Run /reload command' })).toBeNull()
  })
})
