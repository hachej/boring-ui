import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { evaluateAssertions, type AssertionContext } from './assertions.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): AssertionContext {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'one-chat-assertions-'))
  roots.push(workspaceRoot)
  mkdirSync(path.join(workspaceRoot, 'agent', 'intents'), { recursive: true })
  mkdirSync(path.join(workspaceRoot, '.pi', 'extensions'), { recursive: true })
  writeFileSync(path.join(workspaceRoot, 'agent', 'instructions.md'), 'Call clients members.\n')
  writeFileSync(path.join(workspaceRoot, 'agent', 'intents', 'suppliers-list.md'), 'status: agreed\n')
  writeFileSync(path.join(workspaceRoot, '.pi', 'extensions', 'count-items.ts'), 'export default {}\n')
  return {
    workspaceRoot,
    turns: [{
      reply: 'There are 4 members.',
      toolCalls: [{ name: 'update_my_instructions' }, { name: 'count_items' }],
      toolCallsBeforeAnswer: [{ name: 'ask_user' }],
      cardShown: true,
      changedBeforeAnswer: [],
    }],
  }
}

describe('evaluateAssertions', () => {
  it('checks replies, tools, files, intents, cards, and plain language', () => {
    const results = evaluateAssertions([
      { reply_matches: '/members/i' },
      { reply_not_matches: '/cannot see/i' },
      { tool_called: '/count/' },
      { tool_not_called: 'write', before_answer: true },
      { file_exists: '.pi/extensions/*.ts' },
      { file_contains: { path: 'agent/instructions.md', regex: '/members/i' } },
      { file_not_contains: { path: 'agent/instructions.md', regex: '/clients only/i' } },
      { intent_status: { slug: 'suppliers*', status: 'agreed' } },
      { card_shown: true },
      { no_jargon: true },
    ], fixture())

    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('keeps failed optional assertions visible without changing their result', () => {
    const [result] = evaluateAssertions([{ tool_called: 'run_builder', optional: true }], fixture())
    expect(result).toMatchObject({ ok: false, optional: true })
  })

  it('fails a before-answer mutation even when no destructive tool was observed', () => {
    const context = fixture()
    const [result] = evaluateAssertions([{ tool_not_called: 'bash-with-rm', before_answer: true }], {
      ...context,
      turns: [{ ...context.turns[0]!, changedBeforeAnswer: ['data/items.json'] }],
    })
    expect(result?.ok).toBe(false)
    expect(result?.actual).toContain('data/items.json')
  })
})
