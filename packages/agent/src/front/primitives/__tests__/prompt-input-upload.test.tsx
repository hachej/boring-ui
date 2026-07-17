// @vitest-environment jsdom
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PromptInput,
  PromptInputProvider,
  PromptInputTextarea,
  PromptInputSubmit,
  usePromptInputAttachments,
} from '../prompt-input'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-id') }))

URL.createObjectURL = vi.fn(() => 'blob:fake')
URL.revokeObjectURL = vi.fn()

// ----------------------------------------------------------------------------
// Harness helpers
// ----------------------------------------------------------------------------

function AttachmentStatus() {
  const { files } = usePromptInputAttachments()
  return (
    <>
      <span data-testid="status">{files[0]?.status ?? 'none'}</span>
      <span data-testid="count">{files.length}</span>
    </>
  )
}

interface HarnessProps {
  onUploadFile?: (f: File) => Promise<{ url: string; path?: string }>
  onSubmit?: (v: { text: string; files: unknown[] }) => false | void | Promise<false | void>
  initialFiles?: Array<{ type: 'file'; mediaType: string; url: string; filename?: string }>
}

function Harness({ onUploadFile, onSubmit, initialFiles }: HarnessProps) {
  return (
    <PromptInput
      onUploadFile={onUploadFile}
      onSubmit={onSubmit ?? (() => {})}
      initialFiles={initialFiles}
    >
      <PromptInputTextarea />
      <PromptInputSubmit />
      <AttachmentStatus />
    </PromptInput>
  )
}

function ProviderHarness({ onUploadFile, onSubmit }: HarnessProps) {
  return (
    <PromptInputProvider>
      <Harness onUploadFile={onUploadFile} onSubmit={onSubmit} />
    </PromptInputProvider>
  )
}

function pasteFile(textarea: HTMLElement, file: File) {
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', getAsFile: () => file }],
    },
  })
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('PromptInput — upload flow', () => {
  beforeEach(() => {
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:fake')
  })

  it('starts with already-uploaded recovery attachments', () => {
    const initialFiles = [{ type: 'file' as const, mediaType: 'text/plain', filename: 'retry.txt', url: 'https://example.test/retry.txt' }]
    render(<Harness initialFiles={initialFiles} />)

    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('status').textContent).toBe('ready')
  })

  it('starts as uploading when onUploadFile is provided', async () => {
    const onUploadFile = vi.fn(() => new Promise<{ url: string }>(() => {}))

    render(<Harness onUploadFile={onUploadFile} />)

    const textarea = screen.getByRole('textbox')
    const file = new File(['x'], 'img.png', { type: 'image/png' })

    act(() => {
      pasteFile(textarea, file)
    })

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1')
    })
    expect(screen.getByTestId('status').textContent).toBe('uploading')
  })

  it('status becomes ready after upload resolves', async () => {
    const onUploadFile = vi.fn(() =>
      Promise.resolve({ url: 'https://example.com/img.png' }),
    )

    render(<Harness onUploadFile={onUploadFile} />)

    const textarea = screen.getByRole('textbox')
    const file = new File(['x'], 'img.png', { type: 'image/png' })

    act(() => {
      pasteFile(textarea, file)
    })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready')
    })
  })

  it('status becomes error when upload rejects', async () => {
    const onUploadFile = vi.fn(() => Promise.reject(new Error('upload failed')))

    render(<Harness onUploadFile={onUploadFile} />)

    const textarea = screen.getByRole('textbox')
    const file = new File(['x'], 'img.png', { type: 'image/png' })

    act(() => {
      pasteFile(textarea, file)
    })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error')
    })
  })

  it('submits uploaded stable attachment URLs once ready', async () => {
    const onUploadFile = vi.fn(() => Promise.resolve({ url: 'https://example.com/img.png', path: 'assets/images/img.png' }))
    const onSubmit = vi.fn()

    render(<Harness onUploadFile={onUploadFile} onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const file = new File(['x'], 'img.png', { type: 'image/png' })

    act(() => {
      pasteFile(textarea, file)
    })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready')
    })
    fireEvent.change(textarea, { target: { value: 'describe image' } })
    fireEvent.submit(textarea.closest('form')!)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        {
          text: 'describe image',
          files: [expect.objectContaining({ filename: 'img.png', mediaType: 'image/png', url: 'https://example.com/img.png', path: 'assets/images/img.png' })],
        },
        expect.anything(),
      )
    })
  })

  it('submit is blocked while a file is still uploading', async () => {
    const onUploadFile = vi.fn(() => new Promise<{ url: string }>(() => {}))
    const onSubmit = vi.fn()

    render(<Harness onUploadFile={onUploadFile} onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox')
    const file = new File(['x'], 'img.png', { type: 'image/png' })

    act(() => {
      pasteFile(textarea, file)
    })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('uploading')
    })

    // Attempt to submit the form while an upload is in progress.
    const form = textarea.closest('form')!
    fireEvent.submit(form)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('preserves composer text when onSubmit returns false', async () => {
    const onSubmit = vi.fn().mockReturnValue(false)

    render(<Harness onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'keep this draft' } })
    fireEvent.submit(textarea.closest('form')!)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        { text: 'keep this draft', files: [] },
        expect.anything(),
      )
    })
    expect(textarea.value).toBe('keep this draft')
  })

  it('does not wipe provider-backed text typed while async submit is pending', async () => {
    let resolveSubmit: (() => void) | undefined
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn(async () => submitPromise)

    render(<ProviderHarness onSubmit={onSubmit} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'submitted draft' } })
    fireEvent.submit(textarea.closest('form')!)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        { text: 'submitted draft', files: [] },
        expect.anything(),
      )
    })
    expect(textarea.value).toBe('')

    fireEvent.change(textarea, { target: { value: 'next draft' } })

    await act(async () => {
      resolveSubmit?.()
      await submitPromise
    })

    expect(textarea.value).toBe('next draft')
  })
})
