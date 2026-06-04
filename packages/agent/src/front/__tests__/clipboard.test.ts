// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'

import { copyTextToClipboard } from '../clipboard'

describe('copyTextToClipboard', () => {
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    document.execCommand = originalExecCommand
  })

  test('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    await expect(copyTextToClipboard('copy me')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('copy me')
    expect(execCommand).not.toHaveBeenCalled()
  })

  test('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    await expect(copyTextToClipboard('copy me')).resolves.toBe(true)

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  test('falls back to execCommand when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not focused'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    await expect(copyTextToClipboard('copy me')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('copy me')
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  test('returns false when both clipboard paths fail', async () => {
    const execCommand = vi.fn().mockReturnValue(false)
    document.execCommand = execCommand

    await expect(copyTextToClipboard('copy me')).resolves.toBe(false)
  })
})
