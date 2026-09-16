import { execFileSync } from 'node:child_process'
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
  execFileSync('git', ['init', '-b', 'main'], { cwd: workspaceRoot, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: workspaceRoot, stdio: 'ignore' })
  execFileSync('git', [
    '-c', 'user.name=One Chat Test',
    '-c', 'user.email=one-chat-test@local.invalid',
    'commit', '-m', 'Keep suppliers\n\nOne-Chat-Intent: suppliers-list',
  ], { cwd: workspaceRoot, stdio: 'ignore' })
  return {
    workspaceRoot,
    turns: [{
      reply: 'There are 4 members.',
      toolCalls: [
        { name: 'update_my_instructions' },
        { name: 'count_items', input: {} },
        {
          name: 'ask_user',
          input: {
            title: 'Best first version',
            context: 'This is a preview — nothing here is saved. Choose how we should work.',
            schema: {
              fields: [{
                options: [
                  { label: 'Guided list (recommended)', description: 'I will prepare the next action while you stay in control.' },
                  { label: 'Daily queue', description: 'I will answer questions and keep the queue ready.' },
                  { label: 'Something else' },
                ],
              }],
            },
          },
        },
      ],
      toolCallsBeforeAnswer: [{ name: 'ask_user' }],
      cardShown: true,
      cardsShown: 2,
      recommendedCards: 2,
      userTurnsBeforeAgreement: 6,
      changedPaths: ['src/routes/index.tsx'],
      changedBeforeAnswer: [],
    }],
  }
}

describe('evaluateAssertions', () => {
  it('checks replies, tools, files, intents, cards, and plain language', () => {
    const results = evaluateAssertions([
      { reply_matches: '/members/i' },
      { reply_not_matches: '/cannot see/i' },
      { any_reply_matches: '/4 members/i' },
      { any_assistant_text_matches: '/guided list/i' },
      { tool_called: '/count/' },
      { tool_called_with: { name: 'count_items', args_match: {} } },
      { tool_input_matches: { name: 'ask_user', regex: '/preview.*nothing.*saved/i' } },
      { tool_not_called: 'write', before_answer: true },
      { file_exists: '.pi/extensions/*.ts' },
      { file_changed: 'src/**/*' },
      { file_contains: { path: 'agent/instructions.md', regex: '/members/i' } },
      { file_not_contains: { path: 'agent/instructions.md', regex: '/clients only/i' } },
      { commit_message_contains: '/One-Chat-Intent: suppliers-list/' },
      { git_main_exists: true },
      { intent_status: { slug: '*supplier*', status: '/agreed|sketched/' } },
      { card_shown: true },
      { cards_shown_min: 2 },
      { cards_follow_recommendation_rule: true },
      { solution_exploration_card: true },
      { user_turns_before_agreement_min: 6 },
      { no_multi_user_promise: true },
      { no_jargon: true },
    ], fixture())

    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('does not mistake a comfort card for solution exploration', () => {
    const context = fixture()
    const comfortCard = {
      ...context.turns[0]!,
      toolCalls: [{
        name: 'ask_user',
        input: {
          title: 'Your comfort with apps',
          schema: {
            fields: [{
              label: 'How comfortable are you?',
              options: [
                { label: 'Basic (recommended)', description: 'I will keep it simple.' },
                { label: 'Comfortable', description: 'I will include more detail.' },
                { label: 'Something else' },
              ],
            }],
          },
        },
      }],
    }
    const [result] = evaluateAssertions([{ solution_exploration_card: true }], {
      ...context,
      turns: [comfortCard],
    })
    expect(result?.ok).toBe(false)
  })

  it('allows a capability boundary without treating later sharing as a promise', () => {
    const context = fixture()
    const [result] = evaluateAssertions([{ no_multi_user_promise: true }], {
      ...context,
      turns: [{
        ...context.turns[0]!,
        reply: 'Team use is not possible yet, but I can make this useful for you and keep it ready for sharing later.',
      }],
    })
    expect(result?.ok).toBe(true)
  })

  it('rejects a promise to add team use', () => {
    const context = fixture()
    const [result] = evaluateAssertions([{ no_multi_user_promise: true }], {
      ...context,
      turns: [{ ...context.turns[0]!, reply: 'I will add sharing for your team.' }],
    })
    expect(result?.ok).toBe(false)
  })

  it('matches a tool by name and a subset of nested arguments', () => {
    const context = fixture()
    const [result] = evaluateAssertions([{
      tool_called_with: { name: 'run_builder', args_match: { stage: 'mockup' } },
    }], {
      ...context,
      turns: [{
        ...context.turns[0]!,
        toolCalls: [{ name: 'run_builder', input: { slug: 'suppliers', stage: 'mockup' } }],
      }],
    })
    expect(result?.ok).toBe(true)
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
