// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useComposerPickers } from '../useComposerPickers'

function Harness() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pickers = useComposerPickers({ textareaRef })

  return (
    <div>
      <textarea
        aria-label="Draft"
        ref={textareaRef}
        onChange={pickers.handleComposerChange}
      />
      <button type="button" onClick={() => pickers.selectMention('/workspace/src/readme.md')}>
        Pick file
      </button>
      <button type="button" onClick={() => pickers.selectMention('/workspace/docs/readme.md')}>
        Pick duplicate file
      </button>
      <button type="button" onClick={() => pickers.selectSlashCommand('reload')}>
        Pick command
      </button>
      <output aria-label="Mentioned files">{pickers.mentionedFiles.join(',')}</output>
    </div>
  )
}

describe('useComposerPickers', () => {
  it('clears picked file mentions when their visible token leaves the draft', async () => {
    render(<Harness />)

    const textarea = screen.getByLabelText('Draft')
    fireEvent.change(textarea, { target: { value: '@read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick file' }))

    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/src/readme.md'))
    expect((textarea as HTMLTextAreaElement).value).toBe('@readme.md')

    fireEvent.change(textarea, { target: { value: '' } })

    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe(''))
  })

  it('does not keep picked files when the visible mention token is only a prefix', async () => {
    render(<Harness />)

    const textarea = screen.getByLabelText('Draft') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '@read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick file' }))

    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/src/readme.md'))

    fireEvent.change(textarea, { target: { value: 'review @readme.md,' } })
    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/src/readme.md'))

    fireEvent.change(textarea, { target: { value: 'review @readme.md.bak' } })
    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe(''))
  })

  it('clears picked file mentions when selecting a slash command replaces the draft', async () => {
    render(<Harness />)

    const textarea = screen.getByLabelText('Draft')
    fireEvent.change(textarea, { target: { value: '@read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick file' }))
    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/src/readme.md'))

    fireEvent.click(screen.getByRole('button', { name: 'Pick command' }))

    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe(''))
    expect((textarea as HTMLTextAreaElement).value).toBe('/reload ')
  })

  it('keeps same-basename file mentions independently removable', async () => {
    render(<Harness />)

    const textarea = screen.getByLabelText('Draft') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '@read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick file' }))
    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/src/readme.md'))

    const secondDraft = `${textarea.value} @read`
    fireEvent.change(textarea, { target: { value: secondDraft, selectionStart: secondDraft.length, selectionEnd: secondDraft.length } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick duplicate file' }))

    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/src/readme.md,/workspace/docs/readme.md'))
    expect(textarea.value).toBe('@readme.md @workspace/docs/readme.md')

    fireEvent.change(textarea, { target: { value: '@workspace/docs/readme.md' } })

    await waitFor(() => expect(screen.getByLabelText('Mentioned files').textContent).toBe('/workspace/docs/readme.md'))
  })
})
