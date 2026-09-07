import { describe, expect, it } from 'vitest'
import { buildEpicKickoffPrompt, FACTORY_DEFAULT_PLAN_BUDGET_MS } from './epicKickoff'
import type { FactoryEpicEntry } from './epicRegistry'

describe('Factory epic kickoff prompt', () => {
  it('carries the host Gate 1 deadline and names host-enforced dispatch and recovery tools', () => {
    const now = Date.parse('2026-09-05T12:00:00.000Z')
    const entry: FactoryEpicEntry = {
      epicKey: 'factory-limits',
      featureName: 'Factory Limits',
      worktree: '/repo/.worktrees/factory-limits',
      branch: 'factory-limits',
      repositoryRoot: '/repo',
      createdAt: new Date(now).toISOString(),
      status: 'active',
    }

    const prompt = buildEpicKickoffPrompt(entry, 'Implement the bounded Factory limits.', now)

    expect(prompt).toContain(`host deadline ${new Date(now + FACTORY_DEFAULT_PLAN_BUDGET_MS).toISOString()}`)
    expect(prompt).toContain('BORING_FACTORY_PLAN_BUDGET_MS')
    expect(prompt).toContain('call dispatch_worker with the exact ready Bead as beadId')
    expect(prompt).toContain('call recover_stale_claims')
    expect(prompt).not.toContain('Do not name a specific Bead')
  })

  it('preserves a deadline persisted by the host', () => {
    const deadline = '2026-09-05T12:07:00.000Z'
    const entry: FactoryEpicEntry = {
      epicKey: 'factory-limits', featureName: 'Factory Limits', worktree: '/worktree', branch: 'factory-limits',
      repositoryRoot: '/repo', createdAt: '2026-09-05T12:00:00.000Z', planDeadlineAt: deadline, status: 'active',
    }
    expect(buildEpicKickoffPrompt(entry, undefined, 0)).toContain(`host deadline ${deadline}`)
  })
})
