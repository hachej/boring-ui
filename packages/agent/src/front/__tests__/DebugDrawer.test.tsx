// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('lucide-react', () => {
  const Icon = () => <svg />
  return {
    CheckIcon: Icon,
    ChevronDownIcon: Icon,
    ChevronRightIcon: Icon,
    CopyIcon: Icon,
    RefreshCwIcon: Icon,
  }
})

import { DebugDrawer } from '../DebugDrawer'

describe('DebugDrawer', () => {
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    document.execCommand = originalExecCommand
  })

  test('shows pi session id and terminal resume command by default', () => {
    const html = renderToStaticMarkup(
      <DebugDrawer
        sessionId="sess-debug-123"
        messages={[]}
        width={440}
        onWidthChange={() => {}}
      />,
    )

    expect(html).toContain('Session')
    expect(html).toContain('Pi session id')
    expect(html).toContain('sess-debug-123')
    expect(html).toContain('pi --session sess-debug-123')
    expect(html).toContain('pi --continue')
  })

  test('copy buttons use legacy fallback when clipboard API is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    render(
      <DebugDrawer
        sessionId="sess-debug-123"
        messages={[]}
        width={440}
        onWidthChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy Pi session id' }))

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('copy')
    })
  })
})
