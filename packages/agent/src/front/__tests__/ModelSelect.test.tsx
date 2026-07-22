// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModelSelect, ThinkingSelect } from '../chatPanelComposerControls'
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
    expect(screen.getByText('GPT-4o (OpenAI)')).toBeTruthy()
  })

  it('supports a required-field placeholder and error description', () => {
    render(
      <ModelSelect
        value={null}
        onChange={() => {}}
        options={makeOptions(2)}
        emptyLabel="Select model"
        ariaInvalid
        ariaDescribedBy="model-help"
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Model' })
    expect(trigger.textContent).toContain('Select model')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('model-help')
  })

  it('can hide the default option for required model fields', () => {
    render(
      <ModelSelect
        value={null}
        onChange={() => {}}
        options={makeOptions(2)}
        hideDefaultOption
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    expect(screen.queryByText('auto')).toBeNull()
    expect(screen.getByText('Model 0')).toBeTruthy()
  })

  it('uses the compact bordered composer control style', () => {
    render(
      <ModelSelect
        value={{ provider: 'openai', id: 'gpt-4o' }}
        onChange={() => {}}
        options={[
          { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o', available: true },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Model' })
    expect(trigger.className).toContain('rounded-lg')
    expect(trigger.className).toContain('border-border/60')
    expect(trigger.className).not.toContain('rounded-full')
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
    expect(screen.getByText('Model 1').className).toContain('truncate')
  })

  it('opens from external signal changes but not from the initial signal value', async () => {
    const props = {
      value: { provider: 'openai', id: 'model-0' },
      onChange: () => {},
      options: makeOptions(2),
      trigger: 'slash' as const,
    }
    const { rerender } = render(<ModelSelect {...props} openSignal={0} />)

    expect(screen.queryByText('Default model')).toBeNull()

    rerender(<ModelSelect {...props} openSignal={1} />)

    expect(await screen.findByText('Default model')).toBeTruthy()
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
    const search = screen.getByPlaceholderText('Search models…')
    expect(search).toBeTruthy()
    expect(search.closest('div')?.className).toContain('border-b')
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

    expect(screen.getByText('Claude Sonnet (Anthropic)')).toBeTruthy()
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

  it('lets users clear a model override back to the default model', () => {
    const onChange = vi.fn()
    render(
      <ModelSelect
        value={{ provider: 'openai', id: 'model-1' }}
        onChange={onChange}
        options={makeOptions(3)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    fireEvent.click(screen.getByText('auto'))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('closes an open model menu when disabled', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ModelSelect
        value={null}
        onChange={onChange}
        options={makeOptions(3)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    expect(screen.getByText('Model 1')).toBeTruthy()

    rerender(
      <ModelSelect
        value={null}
        onChange={onChange}
        options={makeOptions(3)}
        disabled
      />,
    )

    expect(screen.getByRole('button', { name: 'Model' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Model 1')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
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

  it('renders a quiet slash-status trigger and opens from an external slash request', () => {
    const { rerender } = render(
      <ModelSelect
        value={null}
        onChange={() => {}}
        options={makeOptions(2)}
        trigger="slash"
        openSignal={0}
      />,
    )

    const trigger = screen.getByRole('button', { name: /Current model: Default model/ })
    expect(trigger.textContent).toContain('/model: Default model')
    expect(trigger.className).toContain('whitespace-nowrap')
    expect(trigger.className).toContain('overflow-hidden')
    expect(trigger.className).toContain('text-ellipsis')
    expect(screen.queryByText('Model 1')).toBeNull()

    rerender(
      <ModelSelect
        value={null}
        onChange={() => {}}
        options={makeOptions(2)}
        trigger="slash"
        openSignal={1}
      />,
    )

    expect(screen.getByText('Model 1')).toBeTruthy()
  })
})

describe('ThinkingSelect', () => {
  it('uses the same compact bordered trigger language as model select', () => {
    render(<ThinkingSelect value="off" onChange={() => {}} />)

    const trigger = screen.getByRole('button', { name: 'Thinking level: Off' })
    expect(trigger.className).toContain('rounded-lg')
    expect(trigger.className).toContain('border')
    expect(trigger.className).toContain('border-border/60')
    expect(trigger.textContent).toContain('Off')
  })

  it('opens a matching command-style menu and selects a thinking level', () => {
    const onChange = vi.fn()
    render(<ThinkingSelect value="off" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Thinking level: Off' }))
    const high = screen.getByText('Deep reasoning')
    const item = high.closest('[cmdk-item]')

    expect(item?.className).toContain('rounded-md')
    fireEvent.click(high)
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('uses the normal open surface when an active thinking level menu is open', () => {
    render(<ThinkingSelect value="high" onChange={() => {}} />)

    const trigger = screen.getByRole('button', { name: 'Thinking level: High' })
    expect(trigger.className).toContain('bg-[color:oklch(from_var(--accent)_l_c_h/0.08)]')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.className).toContain('bg-muted/55')
    expect(trigger.className).not.toContain('bg-[color:oklch(from_var(--accent)_l_c_h/0.08)]')
  })

  it('closes an open thinking menu when disabled', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ThinkingSelect value="off" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Thinking level: Off' }))
    expect(screen.getByText('Deep reasoning')).toBeTruthy()

    rerender(<ThinkingSelect value="off" onChange={onChange} disabled />)

    expect(screen.getByRole('button', { name: 'Thinking level: Off' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Deep reasoning')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders a quiet slash-status trigger and opens from an external slash request', () => {
    const { rerender } = render(<ThinkingSelect value="medium" onChange={() => {}} trigger="slash" openSignal={0} />)

    const trigger = screen.getByRole('button', { name: 'Thinking level: Med' })
    expect(trigger.textContent).toContain('/thinking: medium')
    expect(screen.queryByText('Deep reasoning')).toBeNull()

    rerender(<ThinkingSelect value="medium" onChange={() => {}} trigger="slash" openSignal={1} />)

    expect(screen.getByText('Deep reasoning')).toBeTruthy()
  })
})
