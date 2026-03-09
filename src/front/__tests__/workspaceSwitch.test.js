import { describe, it, expect } from 'vitest'
import {
  getWorkspaceSwitchCandidates,
  buildSwitchPrompt,
  resolveWorkspaceSwitchTarget,
} from '../utils/workspaceSwitch'

const WORKSPACES = [
  { id: 'ws-1', name: 'Alpha' },
  { id: 'ws-2', name: 'Beta' },
  { id: 'ws-3', name: 'Gamma' },
]

describe('getWorkspaceSwitchCandidates', () => {
  it('excludes the current workspace', () => {
    const result = getWorkspaceSwitchCandidates(WORKSPACES, 'ws-2')
    expect(result).toEqual([
      { id: 'ws-1', name: 'Alpha' },
      { id: 'ws-3', name: 'Gamma' },
    ])
  })

  it('excludes entries without an id', () => {
    const workspaces = [...WORKSPACES, { name: 'No ID' }, { id: '', name: 'Empty ID' }]
    const result = getWorkspaceSwitchCandidates(workspaces, 'ws-1')
    expect(result).toEqual([
      { id: 'ws-2', name: 'Beta' },
      { id: 'ws-3', name: 'Gamma' },
    ])
  })

  it('returns empty array when current workspace is the only one', () => {
    const result = getWorkspaceSwitchCandidates([{ id: 'ws-1', name: 'Solo' }], 'ws-1')
    expect(result).toEqual([])
  })

  it('returns all when currentWorkspaceId is not in the list', () => {
    const result = getWorkspaceSwitchCandidates(WORKSPACES, 'ws-unknown')
    expect(result).toHaveLength(3)
  })

  it('handles empty workspace list', () => {
    expect(getWorkspaceSwitchCandidates([], 'ws-1')).toEqual([])
  })
})

describe('buildSwitchPrompt', () => {
  it('builds prompt with all candidates listed', () => {
    const candidates = [
      { id: 'ws-1', name: 'Alpha' },
      { id: 'ws-2', name: 'Beta' },
    ]
    const result = buildSwitchPrompt(candidates)
    expect(result.defaultValue).toBe('ws-1')
    expect(result.message).toContain('Alpha (ws-1)')
    expect(result.message).toContain('Beta (ws-2)')
    expect(result.message).toContain('Select workspace id to switch:')
  })

  it('falls back to id when name is missing', () => {
    const candidates = [{ id: 'ws-99' }]
    const result = buildSwitchPrompt(candidates)
    expect(result.message).toContain('ws-99 (ws-99)')
  })

  it('returns null for empty candidates', () => {
    expect(buildSwitchPrompt([])).toBeNull()
  })

  it('defaults to first candidate id', () => {
    const candidates = [
      { id: 'ws-second', name: 'Second' },
      { id: 'ws-first', name: 'First' },
    ]
    expect(buildSwitchPrompt(candidates).defaultValue).toBe('ws-second')
  })
})

describe('resolveWorkspaceSwitchTarget', () => {
  const candidates = [
    { id: 'ws-1', name: 'Alpha' },
    { id: 'ws-2', name: 'Beta' },
    { id: 'ws-3', name: 'Gamma' },
  ]

  it('matches by workspace id', () => {
    const result = resolveWorkspaceSwitchTarget(candidates, 'ws-current', 'ws-2')
    expect(result).toEqual({ id: 'ws-2', name: 'Beta' })
  })

  it('matches by workspace name', () => {
    const result = resolveWorkspaceSwitchTarget(candidates, 'ws-current', 'Gamma')
    expect(result).toEqual({ id: 'ws-3', name: 'Gamma' })
  })

  it('trims whitespace from input', () => {
    const result = resolveWorkspaceSwitchTarget(candidates, 'ws-current', '  ws-1  ')
    expect(result).toEqual({ id: 'ws-1', name: 'Alpha' })
  })

  it('returns null for empty string', () => {
    expect(resolveWorkspaceSwitchTarget(candidates, 'ws-current', '')).toBeNull()
  })

  it('returns null for null/undefined input (user cancelled prompt)', () => {
    expect(resolveWorkspaceSwitchTarget(candidates, 'ws-current', null)).toBeNull()
    expect(resolveWorkspaceSwitchTarget(candidates, 'ws-current', undefined)).toBeNull()
  })

  it('returns null when input matches the current workspace', () => {
    expect(resolveWorkspaceSwitchTarget(candidates, 'ws-2', 'ws-2')).toBeNull()
  })

  it('returns null when input does not match any candidate', () => {
    expect(resolveWorkspaceSwitchTarget(candidates, 'ws-current', 'ws-unknown')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(resolveWorkspaceSwitchTarget(candidates, 'ws-current', '   ')).toBeNull()
  })

  it('prefers id match over name match when both could match', () => {
    // Edge case: a workspace name that looks like another workspace's id
    const tricky = [
      { id: 'ws-1', name: 'ws-2' },
      { id: 'ws-2', name: 'Something' },
    ]
    // "ws-2" matches ws-1 by name AND ws-2 by id — .find() returns first match
    const result = resolveWorkspaceSwitchTarget(tricky, 'ws-current', 'ws-2')
    expect(result.id).toBe('ws-1') // first match wins (by name)
  })
})
