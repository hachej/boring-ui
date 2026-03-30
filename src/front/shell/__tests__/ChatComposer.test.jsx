import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatComposer from '../ChatComposer'

describe('ChatComposer', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    status: 'ready',
    disabled: false,
  }

  it('renders pill-shaped input with textbox role', () => {
    render(<ChatComposer {...defaultProps} />)
    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
  })

  it('shows keyboard hints', () => {
    render(<ChatComposer {...defaultProps} />)
    // Should show command+K kbd hints
    expect(screen.getByText('K')).toBeInTheDocument()
  })

  it('send button is disabled when input is empty', () => {
    render(<ChatComposer {...defaultProps} value="" />)
    const sendButton = screen.getByTestId('chat-send-btn')
    expect(sendButton).toBeDisabled()
  })

  it('send button is enabled when input has text', () => {
    render(<ChatComposer {...defaultProps} value="Hello" />)
    const sendButton = screen.getByTestId('chat-send-btn')
    expect(sendButton).not.toBeDisabled()
  })

  it('shows Stop button (Square icon) when status is streaming', () => {
    render(<ChatComposer {...defaultProps} value="test" status="streaming" />)
    const stopButton = screen.getByTestId('chat-stop-btn')
    expect(stopButton).toBeInTheDocument()
  })

  it('shows Send button when status is ready', () => {
    render(<ChatComposer {...defaultProps} value="test" status="ready" />)
    const sendButton = screen.getByTestId('chat-send-btn')
    expect(sendButton).toBeInTheDocument()
  })

  it('Enter key calls onSubmit', async () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...defaultProps} value="Hello" onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('Shift+Enter does NOT call onSubmit', async () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...defaultProps} value="Hello" onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
