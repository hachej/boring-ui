// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModelSelect } from '../chatPanelComposerControls'
import type { AvailableModel } from '../chatPanelSettings'

// jsdom ships no ResizeObserver / scrollIntoView. cmdk + radix-popover use them.
beforeAll(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    class { observe() {}; unobserve() {}; disconnect() {} }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {}
  }
})

function makeOptions(count: number): AvailableModel[] {
  return Array.from({ length: count }, (_, i) => ({
    provider: 'openai',
    id: `model-${i}`,
    label: `Model ${i}`,
    available: true,
  }))
}

describe('ModelSelect', () => {
  it('renders the trigger with the selected model label', () => {
    render(
      <ModelSelect
        value={{ provider: 'openai', id: 'gpt-4o' }}
        onChange={() => {}}
        options={[
          { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o', available: true },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Model' })).toBeTruthy()
    expect(screen.getByText('GPT-4o')).toBeTruthy()
  })

  it('opens the popover without throwing when option count <= 8', () => {
    render(
      <ModelSelect
        value={null}
        onChange={() => {}}
        options={makeOptions(5)}
      />,
    )
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Model' }))).not.toThrow()
  })

  // REGRESSION: when option count > 8, the search CommandInput renders.
  // It must be inside the <Command> provider — cmdk's CommandInput calls
  // useCommand() to subscribe to the cmdk store. If rendered outside the
  // provider, the context resolves to undefined and the subscribe call
  // crashes ("can't access property 'subscribe', o is undefined"). The
  // bug shipped because the test suite only exercised <=8 options, so
  // CommandInput never rendered and never crashed.
  it('opens the popover without throwing when option count > 8 (search input shown)', () => {
    render(
      <ModelSelect
        value={null}
        onChange={() => {}}
        options={makeOptions(12)}
      />,
    )
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Model' }))).not.toThrow()
    // Search input should be in the document — proves CommandInput mounted
    // successfully inside Command (would have thrown if not).
    expect(screen.getByPlaceholderText('Search models…')).toBeTruthy()
  })

  it('keeps provider-qualified selections distinct when model ids collide', () => {
    render(
      <ModelSelect
        value={{ provider: 'anthropic', id: 'sonnet' }}
        onChange={() => {}}
        options={[
          { provider: 'anthropic', id: 'sonnet', label: 'Claude Sonnet', available: true },
          { provider: 'openrouter', id: 'sonnet', label: 'OpenRouter Sonnet', available: true },
        ]}
      />,
    )

    expect(screen.getByText('Claude Sonnet')).toBeTruthy()
  })

  it('invokes onChange when a model is selected', () => {
    const onChange = vi.fn()
    render(
      <ModelSelect
        value={null}
        onChange={onChange}
        options={makeOptions(3)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    fireEvent.click(screen.getByText('Model 1'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', id: 'model-1' }),
    )
  })

  it('does not throw on selection when option count > 8 (full open + click flow)', () => {
    const onChange = vi.fn()
    render(
      <ModelSelect
        value={null}
        onChange={onChange}
        options={makeOptions(10)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    expect(() => fireEvent.click(screen.getByText('Model 3'))).not.toThrow()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', id: 'model-3' }),
    )
  })
})
