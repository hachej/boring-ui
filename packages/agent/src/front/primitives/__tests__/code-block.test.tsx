// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '../code-block'

describe('CodeBlockCopyButton', () => {
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    document.execCommand = originalExecCommand
  })

  test('copies fenced code block content with clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(
      <CodeBlock code={'const answer = 42'} language="ts">
        <CodeBlockHeader>
          <CodeBlockTitle>ts</CodeBlockTitle>
          <CodeBlockCopyButton />
        </CodeBlockHeader>
      </CodeBlock>,
    )

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('const answer = 42')
    })
  })

  test('falls back to legacy copy when clipboard API is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    render(
      <CodeBlock code={'const answer = 42'} language="ts">
        <CodeBlockHeader>
          <CodeBlockTitle>ts</CodeBlockTitle>
          <CodeBlockCopyButton />
        </CodeBlockHeader>
      </CodeBlock>,
    )

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('copy')
    })
  })
})
