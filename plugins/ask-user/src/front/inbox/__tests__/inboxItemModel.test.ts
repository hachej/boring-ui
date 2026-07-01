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
    artifact: null,
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
      inbox: {
        kind: 'question',
        sourceLabel: 'question',
        source: { type: 'plugin', id: 'ask-user', label: 'question' },
        priority: 5,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      actions: [{ id: 'open', label: 'Open' }],
    })

    expect(inbox).toMatchObject({
      id: 'b1',
      kind: 'question',
      title: 'Need input',
      sessionId: 's1',
      targetLabel: 'file.ts',
      priority: 5,
    })
    expect(inbox.source).toEqual({ type: 'plugin', pluginId: 'ask-user', label: 'question' })
    expect(inbox.artifact).toEqual({ type: 'surface', surfaceKind: 'file', target: 'file.ts', label: 'file.ts' })
    expect(inbox.artifacts).toEqual([{ type: 'surface', surfaceKind: 'file', target: 'file.ts', label: 'file.ts' }])
    expect(inbox.actions).toEqual([{ id: 'open', label: 'Open' }])
  })

  it('uses explicit inbox artifact pointers when present', () => {
    const inbox = attentionBlockerToInboxItem({
      id: 'review-artifacts',
      reason: 'ask-user.review',
      label: 'Review landing page',
      target: 'legacy-target',
      surfaceKind: 'legacy-surface',
      inbox: {
        kind: 'review',
        sourceLabel: 'review',
        artifacts: [
          { type: 'surface', id: 'html', label: 'Generated HTML', surfaceKind: 'workspace.open.path', target: 'docs/generated.html' },
          { type: 'surface', id: 'brief', label: 'Review brief', surfaceKind: 'questions', target: 'q1' },
        ],
      },
    })

    expect(inbox.targetLabel).toBe('Generated HTML')
    expect(inbox.artifact).toEqual({ type: 'surface', id: 'html', label: 'Generated HTML', surfaceKind: 'workspace.open.path', target: 'docs/generated.html' })
    expect(inbox.artifacts).toHaveLength(2)
  })

  it('uses explicit external and review source metadata without parsing reason', () => {
    expect(attentionBlockerToInboxItem({
      id: 'ext',
      reason: 'opaque.reason',
      label: 'External review',
      inbox: { kind: 'review', sourceLabel: 'fallback', source: { type: 'external-hook', id: 'codex-1', label: 'Codex' } },
    }).source).toEqual({ type: 'external-hook', externalId: 'codex-1', label: 'Codex' })

    expect(attentionBlockerToInboxItem({
      id: 'review',
      reason: 'another.opaque.reason',
      label: 'PR review',
      inbox: { kind: 'review', sourceLabel: 'fallback', source: { type: 'review', id: 'pr-123', label: 'PR review' } },
    }).source).toEqual({ type: 'review', reviewId: 'pr-123', label: 'PR review' })
  })

  it('keeps legacy sourceLabel fallback for generic and older blockers', () => {
    expect(attentionBlockerToInboxItem({
      id: 'generic',
      reason: 'human-action.notice',
      label: 'Generic notice',
      inbox: { kind: 'notice', sourceLabel: 'legacy source', source: { type: 'generic', label: 'generic source' } },
    }).source).toEqual({ type: 'plugin', pluginId: 'human-action.notice', label: 'generic source' })

    expect(attentionBlockerToInboxItem({
      id: 'legacy',
      reason: 'ask-user.question',
      label: 'Legacy question',
      inbox: { kind: 'question', sourceLabel: 'question' },
    }).source).toEqual({ type: 'plugin', pluginId: 'ask-user.question', label: 'question' })
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

  it('filters and sorts deterministically', () => {
    const items = [
      item({ id: 'old-review', kind: 'review', updatedAt: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'new-question', kind: 'question', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]

    expect(filterInboxItems(items, 'questions').map((entry) => entry.id)).toEqual(['new-question'])
    expect(sortInboxItems(items).map((entry) => entry.id)).toEqual(['new-question', 'old-review'])
  })

  it('keeps pin state in the view model only', () => {
    const base = item({ id: 'pinned', kind: 'notice', updatedAt: '2026-01-01T00:00:00.000Z' })
    const [view] = mergeInboxPinnedState([base], new Set(['pinned']))
    expect('pinned' in base).toBe(false)
    expect(view.pinned).toBe(true)
  })
})
