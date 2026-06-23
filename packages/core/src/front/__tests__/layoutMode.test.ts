import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT_POLICY, resolveLayoutMode } from '../layoutMode.js'

describe('resolveLayoutMode', () => {
  it('force ignores the user preference', () => {
    expect(resolveLayoutMode({ kind: 'force', mode: 'single-project' }, 'multi-project')).toBe('single-project')
    expect(resolveLayoutMode({ kind: 'force', mode: 'multi-project' }, 'single-project')).toBe('multi-project')
    expect(resolveLayoutMode({ kind: 'force', mode: 'multi-project' }, undefined)).toBe('multi-project')
  })

  it('allow honors the user preference when set', () => {
    expect(resolveLayoutMode({ kind: 'allow', default: 'single-project' }, 'multi-project')).toBe('multi-project')
    expect(resolveLayoutMode({ kind: 'allow', default: 'multi-project' }, 'single-project')).toBe('single-project')
  })

  it('allow falls back to the default when there is no preference', () => {
    expect(resolveLayoutMode({ kind: 'allow', default: 'single-project' }, undefined)).toBe('single-project')
    expect(resolveLayoutMode({ kind: 'allow', default: 'multi-project' }, undefined)).toBe('multi-project')
  })

  it('default policy is allow / single-project', () => {
    expect(DEFAULT_LAYOUT_POLICY).toEqual({ kind: 'allow', default: 'single-project' })
    expect(resolveLayoutMode(DEFAULT_LAYOUT_POLICY, undefined)).toBe('single-project')
  })
})
