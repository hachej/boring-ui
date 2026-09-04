import { describe, expect, it } from 'vitest'
import { attentionBlockerToInboxItem, isInboxAttentionBlocker } from '../attentionBlockerAdapter'
import { filterInboxItems, inboxItemIdForQuestion, mergeInboxItems, mergeInboxPinnedState, pendingSummaryToInboxItem, sortInboxItems, type WorkspaceInboxItem } from '../inboxItemModel'

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
      agentTypeId: 'alpha',
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
      agentTypeId: 'alpha',
      sessionId: 's1',
      targetLabel: 'file.ts',
      priority: 5,
      chatAvailable: true,
    })
    expect(inbox.artifacts).toEqual([{ id: 'b1:surface', surfaceKind: 'file', target: 'file.ts', title: 'Need input' }])
    expect(inbox.actions).toEqual([{ id: 'open', label: 'Open' }])
  })

  it('deduplicates an explicit artifact that already targets the question surface', () => {
    const artifact = { id: 'explicit', surfaceKind: 'questions', target: 'q1', title: 'Answer question' }
    const inbox = attentionBlockerToInboxItem({
      id: 'b1',
      reason: 'ask-user.question',
      label: 'Need input',
      target: 'q1',
      surfaceKind: 'questions',
      inbox: { kind: 'question', sourceLabel: 'question', artifacts: [artifact] },
    })

    expect(inbox.artifacts).toEqual([artifact])
  })

  it('only admits explicit Inbox blockers and never infers missing chat ownership', () => {
    expect(isInboxAttentionBlocker({ id: 'plain', reason: 'composer.blocked', label: 'Plain blocker' })).toBe(false)
    expect(attentionBlockerToInboxItem({
      id: 'ownerless',
      reason: 'ask-user.question',
      label: 'Ownerless',
      sessionId: 'shared-id',
      pruneWhenSessionMissing: true,
      inbox: { kind: 'question', sourceLabel: 'question' },
    }).chatAvailable).toBe(false)
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

describe('workspace-wide pending questions', () => {
  const summary = {
    questionId: 'q-merge',
    sessionId: 'orchestrator-session',
    status: 'ready' as const,
    title: '[Factory Plugin] Merge approval',
    context: 'Approve the epic PR',
    artifacts: [],
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:05:00.000Z',
  }

  it('adapts a pending summary from a background agent session into an inbox item', () => {
    const inbox = pendingSummaryToInboxItem(summary, { fallbackAgentTypeId: 'boring-orchestrator' })
    expect(inbox).toMatchObject({
      id: 'ask-user:orchestrator-session:q-merge',
      kind: 'question',
      title: '[Factory Plugin] Merge approval',
      sessionId: 'orchestrator-session',
      agentTypeId: 'boring-orchestrator',
      chatAvailable: true,
      updatedAt: '2026-09-03T10:05:00.000Z',
    })
    // The row must be able to open the Questions surface for that question.
    expect(inbox.artifacts[0]).toMatchObject({ surfaceKind: 'questions', target: 'q-merge' })
  })

  it('shares one id with the attention blocker for the same question so rows do not double up', () => {
    const blockerItem = attentionBlockerToInboxItem({
      id: inboxItemIdForQuestion('orchestrator-session', 'q-merge'),
      reason: 'ask-user.question',
      surfaceKind: 'questions',
      target: 'q-merge',
      label: 'Hydrated blocker title',
      sessionId: 'orchestrator-session',
      agentTypeId: 'boring-orchestrator',
      inbox: { kind: 'question', sourceLabel: 'question', artifacts: [] },
    })
    const merged = mergeInboxItems([blockerItem], [pendingSummaryToInboxItem(summary)])
    expect(merged).toHaveLength(1)
    // The hydrated blocker wins: it carries actions and artifacts the summary lacks.
    expect(merged[0]?.title).toBe('Hydrated blocker title')
  })

  it('keeps questions that have no attention blocker at all', () => {
    const merged = mergeInboxItems([], [pendingSummaryToInboxItem(summary)])
    expect(merged.map((entry) => entry.id)).toEqual(['ask-user:orchestrator-session:q-merge'])
  })
})
