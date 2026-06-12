// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SlashCommandPicker } from '../slash-command-picker'

describe('SlashCommandPicker', () => {
  beforeAll(() => {
    // jsdom does not implement scrollIntoView, which the picker calls to keep
    // the active row visible.
    Element.prototype.scrollIntoView = vi.fn()
  })

  const commands = [
    { name: 'skill:boring-plugin-authoring', description: 'Author a plugin', source: 'skill' as const, sourcePlugin: 'plugin-authoring' },
    { name: 'open-demo-cmd', description: 'Open the demo panel', source: 'extension' as const, sourcePlugin: 'demo-cmd' },
    { name: 'run', description: 'Run a subagent', source: 'extension' as const, sourcePlugin: 'pi-subagents' },
    { name: 'reload', description: 'Reload plugins', source: 'local' as const },
  ]

  const searchInput = () => screen.getByLabelText('Search commands') as HTMLInputElement

  it('tags plugin-owned skill commands with both skill and plugin tags', () => {
    render(<SlashCommandPicker query="" commands={commands} onSelect={() => {}} onDismiss={() => {}} />)

    const skillRow = screen.getByText('/skill:boring-plugin-authoring').closest('li')
    expect(skillRow?.querySelector('.uppercase')?.textContent).toBe('skill')
    expect(skillRow?.textContent).toContain('plugin-authoring')

    const extensionRow = screen.getByText('/open-demo-cmd').closest('li')
    expect(extensionRow?.textContent).toContain('demo-cmd')
    expect(extensionRow?.querySelector('.uppercase')).toBeNull()

    const localRow = screen.getByText('/reload').closest('li')
    expect(localRow?.textContent).toBe('/reloadReload plugins')
  })

  it('exposes the full description on hover via the row title attribute', () => {
    render(<SlashCommandPicker query="" commands={commands} onSelect={() => {}} onDismiss={() => {}} />)
    const skillRow = screen.getByText('/skill:boring-plugin-authoring').closest('li')
    expect(skillRow?.getAttribute('title')).toBe('Author a plugin')
  })

  it('seeds the search box from the typed query and filters (substring, name or description)', () => {
    render(<SlashCommandPicker query="skill" commands={commands} onSelect={() => {}} onDismiss={() => {}} />)
    expect(searchInput().value).toBe('skill')
    expect(screen.getByText('/skill:boring-plugin-authoring')).toBeTruthy()
    expect(screen.queryByText('/open-demo-cmd')).toBeNull()
    expect(screen.queryByText('/reload')).toBeNull()

    // Typing in the search box updates the filter (matches description too).
    act(() => {
      fireEvent.change(searchInput(), { target: { value: 'subagent' } })
    })
    expect(screen.getByText('/run')).toBeTruthy()
    expect(screen.queryByText('/skill:boring-plugin-authoring')).toBeNull()
  })

  it('filters by the selected plugin chip', () => {
    render(<SlashCommandPicker query="" commands={commands} onSelect={() => {}} onDismiss={() => {}} />)
    // Pick the demo-cmd plugin chip.
    act(() => {
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'demo-cmd' }))
    })
    expect(screen.getByText('/open-demo-cmd')).toBeTruthy()
    expect(screen.queryByText('/run')).toBeNull()
    expect(screen.queryByText('/reload')).toBeNull()
  })

  it('keeps the filter bar visible even when there is only one command group', () => {
    render(<SlashCommandPicker query="" commands={[commands[3]]} onSelect={() => {}} onDismiss={() => {}} />)

    expect(screen.getByRole('tablist', { name: 'Filter by plugin' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'built-in' })).toBeTruthy()
  })

  it('wraps selection with arrow keys from the search input', () => {
    render(<SlashCommandPicker query="" commands={commands} onSelect={() => {}} onDismiss={() => {}} />)
    const options = () => Array.from(document.querySelectorAll('[role="option"]'))
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true')

    act(() => {
      fireEvent.keyDown(searchInput(), { key: 'ArrowUp' })
    })
    const opts = options()
    expect(opts[opts.length - 1]?.getAttribute('aria-selected')).toBe('true')
    expect(opts[0]?.getAttribute('aria-selected')).toBe('false')

    act(() => {
      fireEvent.keyDown(searchInput(), { key: 'ArrowDown' })
    })
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('selects the active command on Enter', () => {
    const onSelect = vi.fn()
    render(<SlashCommandPicker query="" commands={commands} onSelect={onSelect} onDismiss={() => {}} />)
    act(() => {
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
    })
    expect(onSelect).toHaveBeenCalledWith('skill:boring-plugin-authoring')
  })

  it('dismisses on Escape', () => {
    const onDismiss = vi.fn()
    render(<SlashCommandPicker query="" commands={commands} onSelect={() => {}} onDismiss={onDismiss} />)
    act(() => {
      fireEvent.keyDown(searchInput(), { key: 'Escape' })
    })
    expect(onDismiss).toHaveBeenCalled()
  })
})
