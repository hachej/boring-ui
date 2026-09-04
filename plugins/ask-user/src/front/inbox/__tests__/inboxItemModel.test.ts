import { describe, expect, it } from 'vitest'
import { attentionBlockerToInboxItem, isInboxAttentionBlocker } from '../attentionBlockerAdapter'
import { answeredSummaryToInboxItem, filterInboxItems, inboxDecisionBadgeStyle, inboxDecisionTone, inboxItemIdForQuestion, mergeInboxItems, mergeInboxPinnedState, pendingSummaryToInboxItem, sortInboxItems, type WorkspaceInboxItem } from '../inboxItemModel'

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

describe('answered questions', () => {
  const answered = {
    questionId: 'q-gate-2',
    sessionId: 'orchestrator-session',
    title: '[Farewell API] Merge approval',
    contextFirstLine: 'The epic PR is open and the demo ran at the exact SHA.',
    askedAt: '2026-09-03T10:00:00.000Z',
    answeredAt: '2026-09-03T10:07:00.000Z',
    decision: 'approve',
    values: { decision: 'approve', notes: 'Demo matched the brief.' },
    status: 'answered' as const,
  }

  it('adapts an answered summary into a resolved inbox item carrying the decision and notes', () => {
    const item = answeredSummaryToInboxItem(answered, { fallbackAgentTypeId: 'boring-orchestrator' })
    expect(item).toMatchObject({
      id: 'ask-user:orchestrator-session:q-gate-2',
      status: 'resolved',
      title: '[Farewell API] Merge approval',
      description: 'The epic PR is open and the demo ran at the exact SHA.',
      decision: 'approve',
      sessionId: 'orchestrator-session',
      agentTypeId: 'boring-orchestrator',
      chatAvailable: true,
      createdAt: '2026-09-03T10:00:00.000Z',
      updatedAt: '2026-09-03T10:07:00.000Z',
    })
    expect(item.answerValues).toMatchObject({ notes: 'Demo matched the brief.' })
  })

  it('keeps answered items out of the open tabs and alone in the Answered tab', () => {
    const open = pendingSummaryToInboxItem({
      questionId: 'q-open',
      sessionId: 's-open',
      status: 'ready',
      title: 'Still pending',
      artifacts: [],
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T11:00:00.000Z',
    })
    const items = [open, answeredSummaryToInboxItem(answered)]
    expect(filterInboxItems(items, 'all').map((entry) => entry.id)).toEqual([open.id])
    expect(filterInboxItems(items, 'questions').map((entry) => entry.id)).toEqual([open.id])
    expect(filterInboxItems(items, 'answered').map((entry) => entry.id)).toEqual(['ask-user:orchestrator-session:q-gate-2'])
  })

  it('maps verdicts onto badge tones and never guesses an unknown one', () => {
    expect(inboxDecisionTone('approve')).toBe('approve')
    expect(inboxDecisionTone('Request changes')).toBe('changes')
    expect(inboxDecisionTone('defer')).toBe('defer')
    expect(inboxDecisionTone('reject')).toBe('reject')
    expect(inboxDecisionTone('ship it sideways')).toBe('neutral')
    expect(inboxDecisionTone(undefined)).toBe('neutral')
  })

  it('tones badges from workspace tokens, because plugin palette classes are never generated by the host build', () => {
    expect(inboxDecisionBadgeStyle('approve').color).toBe('var(--success)')
    expect(inboxDecisionBadgeStyle('Request changes').color).toBe('var(--attention)')
    expect(inboxDecisionBadgeStyle('reject').color).toBe('var(--destructive)')
    expect(inboxDecisionBadgeStyle('defer').color).toBe('var(--muted-foreground)')
    expect(inboxDecisionBadgeStyle(undefined).color).toBe('var(--muted-foreground)')
    expect(inboxDecisionBadgeStyle('approve').backgroundColor).toContain('color-mix')
  })

  it('cancelled and abandoned questions are dismissed, not resolved', () => {
    expect(answeredSummaryToInboxItem({ ...answered, status: 'cancelled' }).status).toBe('dismissed')
    expect(answeredSummaryToInboxItem({ ...answered, status: 'abandoned' }).status).toBe('dismissed')
  })
})
