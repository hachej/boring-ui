// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createMessageMentionMarkdownComponents } from '../../chat/components/MessageMentions'
import { MessageResponse } from '../message'

const catalog = {
  commands: [{ name: 'reload', clickBehavior: 'execute' as const }],
  skills: [{ name: 'review-code', commandName: 'skill:review-code' }],
  files: true,
}

describe('MessageResponse slash command components', () => {
  it('decorates prose without crossing formatting, links, inline code, or fenced code', async () => {
    const onActivate = vi.fn()
    const components = createMessageMentionMarkdownComponents(catalog, onActivate)
    render(
      <MessageResponse components={components}>{[
        'Please run /reload.',
        '',
        '# Then `/reload`',
        '',
        '- Plain list item',
        '',
        '![diagram](https://example.test/diagram.png)',
        '',
        'Keep [/reload](https://example.test), [**/reload**](https://example.test), [_/reload_](https://example.test), [~~/reload~~](https://example.test), foo**/reload**, **/reload**x, x.**/reload**, **@README.md**.bak, /reload**x**, !review-code**x**, userx**@README.md**, and @README.md**.bak** inert:',
        '',
        '```text',
        '/reload',
        '```',
      ].join('\n')}</MessageResponse>,
    )

    const buttons = await screen.findAllByRole('button', { name: 'Run /reload command' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onActivate).toHaveBeenCalledWith({ kind: 'command', name: 'reload', label: '/reload', behavior: 'execute' })
    expect(screen.getAllByRole('button', { name: '/reload' })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Insert !review-code skill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open README.md' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Then /reload' }).className).toContain('text-3xl')
    expect(screen.getByRole('listitem').className).toContain('py-1')
    expect(document.querySelector('[data-streamdown="image-wrapper"]')?.closest('p')).toBeNull()
    expect(document.querySelector('pre code')?.textContent).toContain('/reload')
    expect(document.querySelector('pre')?.closest('p')).toBeNull()
    expect(document.querySelector('pre button')).toBeNull()
  })

  it('decorates complete tokens inside safe inline formatting and table cells', async () => {
    const onActivate = vi.fn()
    const components = createMessageMentionMarkdownComponents(catalog, onActivate)
    render(
      <MessageResponse components={components}>{[
        '**/reload**',
        '',
        '_/reload_',
        '',
        '~~/reload~~',
        '',
        '| Action |',
        '| --- |',
        '| /reload |',
      ].join('\n')}</MessageResponse>,
    )

    expect(await screen.findAllByRole('button', { name: 'Run /reload command' })).toHaveLength(4)
    expect(document.querySelector('[data-streamdown="strong"]')?.className).toContain('font-semibold')
    expect(document.querySelector('[data-streamdown="table-cell"]')?.className).toContain('px-4')
  })

  it('remounts without stale actions when command actionability changes', async () => {
    const onActivate = vi.fn()
    const components = createMessageMentionMarkdownComponents(catalog, onActivate)
    const { rerender } = render(
      <MessageResponse key="reload:enabled" components={components}>Run /reload.</MessageResponse>,
    )
    expect(await screen.findByRole('button', { name: 'Run /reload command' })).toBeTruthy()

    rerender(<MessageResponse key="no-slash-commands:static">Run /reload.</MessageResponse>)
    expect(screen.queryByRole('button', { name: 'Run /reload command' })).toBeNull()
  })
})
