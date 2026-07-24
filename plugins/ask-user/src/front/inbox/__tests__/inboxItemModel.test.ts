import { describe, expect, it } from 'vitest'
import { attentionBlockerToInboxItem, isInboxAttentionBlocker } from '../attentionBlockerAdapter'
import { filterInboxItems, mergeInboxPinnedState, sortInboxItems, type WorkspaceInboxItem } from '../inboxItemModel'

function item(partial: Partial<WorkspaceInboxItem> & Pick<WorkspaceInboxItem, 'id' | 'kind' | 'updatedAt'>): WorkspaceInboxItem {
  return {
    status: 'open',
    title: partial.id,
    description: '',
    source: { type: 'plugin', pluginId: 'test', label: 'test' },
    sessionId: null,
    targetLabel: '',
    artifacts: [],
    createdAt: partial.updatedAt,
    priority: 0,
    actions: [],
    ...partial,
  }
}

describe('inbox item model', () => {
  it('adapts attention blockers into typed inbox items', () => {
    const inbox = attentionBlockerToInboxItem({
      id: 'b1',
      reason: 'ask-user.question',
      label: 'Need input',
      sessionId: 's1',
      target: 'file.ts',
      surfaceKind: 'file',
      sessionBadge: { kind: 'question', label: 'question', priority: 5 },
      pruneWhenSessionMissing: true,
      inbox: { kind: 'question', sourceLabel: 'question', priority: 5, createdAt: '2026-01-01T00:00:00.000Z' },
      actions: [{ id: 'open', label: 'Open' }],
    })

    expect(inbox).toMatchObject({
      id: 'b1',
      kind: 'question',
      title: 'Need input',
      sessionId: 's1',
      targetLabel: 'file.ts',
      priority: 5,
      chatAvailable: true,
    })
    expect(inbox.artifacts).toEqual([{ id: 'b1:surface', surfaceKind: 'file', target: 'file.ts', title: 'Need input' }])
    expect(inbox.actions).toEqual([{ id: 'open', label: 'Open' }])
  })

  it('only admits blockers explicitly contributed to inbox', () => {
    expect(isInboxAttentionBlocker({ id: 'plain', reason: 'composer.blocked', label: 'Plain blocker' })).toBe(false)
    expect(isInboxAttentionBlocker({
      id: 'question',
      reason: 'ask-user.question',
      label: 'Question',
      inbox: { kind: 'question', sourceLabel: 'question' },
    })).toBe(true)
  })

  it('filters and sorts by recency, then priority deterministically', () => {
    const items = [
      item({ id: 'old-high-priority-review', kind: 'review', updatedAt: '2026-01-01T00:00:00.000Z', priority: 10 }),
      item({ id: 'new-question', kind: 'question', updatedAt: '2026-01-02T00:00:00.000Z' }),
      item({ id: 'tie-high-priority', kind: 'review', updatedAt: '2026-01-02T00:00:00.000Z', priority: 5 }),
    ]

    expect(filterInboxItems(items, 'questions').map((entry) => entry.id)).toEqual(['new-question'])
    expect(sortInboxItems(items).map((entry) => entry.id)).toEqual(['tie-high-priority', 'new-question', 'old-high-priority-review'])
  })

  it('keeps pin state in the view model only', () => {
    const base = item({ id: 'pinned', kind: 'notice', updatedAt: '2026-01-01T00:00:00.000Z' })
    const [view] = mergeInboxPinnedState([base], new Set(['pinned']))
    expect('pinned' in base).toBe(false)
    expect(view.pinned).toBe(true)
  })
})
