// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { CodeBlock } from '../CodeBlock'

describe('bare CodeBlock copy button', () => {
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    document.execCommand = originalExecCommand
  })

  test('falls back to legacy copy when clipboard API is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    render(<CodeBlock code="echo hello" language="bash" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('copy')
    })
    expect(screen.getByRole('button', { name: 'Copy code' }).textContent).toContain('Copied')
  })
})
