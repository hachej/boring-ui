// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { QueuedUserMessage } from '../../../../shared/chat'
import { ComposerBar } from '../ComposerBar'

describe('ComposerBar', () => {
  test('submits on Enter through the prompt primitive without protocol calls', async () => {
    const onSend = vi.fn()
    render(<ComposerBar status="idle" onSend={onSend} />)

    const textarea = screen.getByRole('textbox', { name: 'Agent prompt' })
    fireEvent.change(textarea, { target: { value: '  hello agent  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith({ text: 'hello agent', files: [] })
    })
    expect(screen.getByRole('button', { name: 'Submit' }).getAttribute('data-boring-agent-part')).toBe('composer-submit')
    expect(textarea.closest('[data-boring-agent-part="composer-bar"]')).toBeTruthy()
    expect(textarea.closest('[data-boring-agent-part="composer"]')).toBeTruthy()
    expect(document.querySelector('[data-boring-agent-part="composer-footer"]')).toBeTruthy()
  })

  test('restores focus when focusSignal changes', () => {
    const { rerender } = render(<ComposerBar status="idle" onSend={vi.fn()} focusSignal={0} />)
    const textarea = screen.getByRole('textbox', { name: 'Agent prompt' })
    textarea.blur()
    expect(document.activeElement).not.toBe(textarea)

    rerender(<ComposerBar status="idle" onSend={vi.fn()} focusSignal={1} />)

    expect(document.activeElement).toBe(textarea)
  })

  test('Escape prioritizes stopping an active turn while keeping the composer presentational', () => {
    const onStop = vi.fn()
    const onEscape = vi.fn()
    render(<ComposerBar status="streaming" onSend={vi.fn()} onStop={onStop} onEscape={onEscape} />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Agent prompt' }), { key: 'Escape' })

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onEscape).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  test('renders command errors and queue preview from queue selector output with edit queued control', () => {
    const queuePreview: QueuedUserMessage[] = [
      { id: 'q1', kind: 'followup', displayText: 'first queued', clientSeq: 1 },
      { id: 'q2', kind: 'followup', displayText: 'second queued', clientSeq: 2 },
    ]
    const onEditQueued = vi.fn()
    render(
      <ComposerBar
        status="idle"
        onSend={vi.fn()}
        commandError="Unknown command /wat"
        queuePreview={queuePreview}
        onEditQueued={onEditQueued}
      />,
    )

    const error = screen.getByRole('alert')
    expect(error.getAttribute('data-boring-agent-part')).toBe('composer-command-error')
    expect(error.textContent).toContain('Unknown command /wat')

    const preview = screen.getByText('2 queued follow-ups').closest('[data-boring-agent-part="composer-queue-preview"]') as HTMLElement
    expect(preview.className).toContain('motion-reduce:transition-none')
    expect(within(preview).getByText('first queued · second queued')).toBeTruthy()
    const edit = within(preview).getByRole('button', { name: 'Edit queued follow-ups' })
    expect(edit.textContent).not.toContain('Edit queued')
    fireEvent.click(edit)
    expect(onEditQueued).toHaveBeenCalledWith(queuePreview)
  })
})
