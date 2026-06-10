// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SlashCommandPicker } from '../slash-command-picker'

describe('SlashCommandPicker', () => {
  it('keeps Escape dismissal active when no commands match', () => {
    const onDismiss = vi.fn()
    const onSelect = vi.fn()
    const { container } = render(
      <SlashCommandPicker
        query="unknown"
        commands={[]}
        onSelect={onSelect}
        onDismiss={onDismiss}
      />,
    )

    expect(container.firstChild).toBeNull()

    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onSelect).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
