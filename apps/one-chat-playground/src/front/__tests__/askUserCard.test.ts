import { describe, expect, test } from 'vitest'

import type { PendingQuestionView } from '../../server/askUser'
import { describeAnswer, parseAnsweredValues, resolveQuestionCardState } from '../askUserCard'

const question: PendingQuestionView = {
  questionId: 'q1',
  sessionId: 'one-chat',
  toolCallId: 'call-1',
  title: 'Should I delete the old orders?',
  answerToken: 'token',
  createdAt: '2026-09-15T10:00:00.000Z',
  schema: {
    wireVersion: 1,
    fields: [{
      type: 'radio',
      name: 'choice',
      label: 'What should happen',
      options: [
        { value: 'delete', label: 'Delete them for good' },
        { value: 'hide', label: 'Just hide them' },
      ],
    }],
  },
}

const call = { toolCallId: 'call-1', state: 'input-available' as const }

describe('the question card state', () => {
  test('is pending while the question is waiting for the user', () => {
    const state = resolveQuestionCardState({ call, pending: [question] })
    expect(state).toEqual({ kind: 'pending', question })
  })

  test('matches on the tool call, not on position', () => {
    const other = { ...question, questionId: 'q2', toolCallId: 'call-2' }
    expect(resolveQuestionCardState({ call, pending: [other] }).kind).toBe('gone')
  })

  test('shows the answer the moment it is submitted, before the next poll', () => {
    const state = resolveQuestionCardState({
      call,
      pending: [],
      justAnswered: { 'call-1': { values: { choice: 'delete' }, question } },
    })
    expect(state).toEqual({ kind: 'answered', values: { choice: 'delete' }, question })
  })

  test('recovers the answer from the tool result after a reload', () => {
    const state = resolveQuestionCardState({
      call: {
        ...call,
        state: 'output-available',
        input: { title: question.title, schema: question.schema },
        output: [{ type: 'text', text: 'User answered: {"choice":"hide"}. Continue the conversation using this answer.' }],
      },
      pending: [],
    })
    expect(state).toEqual({
      kind: 'answered',
      values: { choice: 'hide' },
      question: { title: question.title, schema: question.schema },
    })
  })

  test('says nothing at all for a question that was cancelled or is from a previous run', () => {
    expect(resolveQuestionCardState({ call, pending: [] }).kind).toBe('gone')
    expect(
      resolveQuestionCardState({
        call: { ...call, state: 'output-error', output: 'User question cancelled: abandoned' },
        pending: [],
      }).kind,
    ).toBe('gone')
  })
})

describe('parseAnsweredValues', () => {
  test('reads the plugin result text in every shape the transcript carries it', () => {
    const text = 'User answered: {"choice":"delete"}. Continue the conversation using this answer.'
    expect(parseAnsweredValues(text)).toEqual({ choice: 'delete' })
    expect(parseAnsweredValues({ content: [{ type: 'text', text }] })).toEqual({ choice: 'delete' })
  })

  test('is undefined for anything that is not an answer', () => {
    expect(parseAnsweredValues(undefined)).toBeUndefined()
    expect(parseAnsweredValues('User question cancelled: timeout')).toBeUndefined()
    expect(parseAnsweredValues('User answered: not json')).toBeUndefined()
  })
})

describe('describeAnswer', () => {
  test('uses the option label, never the stored value', () => {
    expect(describeAnswer({ choice: 'delete' }, question)).toBe('Delete them for good')
  })

  test('strips the recommendation suffix only from the echoed answer', () => {
    const recommended = {
      ...question,
      schema: {
        ...question.schema!,
        fields: [{
          ...question.schema!.fields[0]!,
          options: [{ value: 'delete', label: 'Delete them for good (recommended)' }],
        }],
      },
    }
    expect(describeAnswer({ choice: 'delete' }, recommended)).toBe('Delete them for good')
    expect(recommended.schema.fields[0]!.options[0]!.label).toBe('Delete them for good (recommended)')
  })

  test('falls back to the plain value when the question is gone', () => {
    expect(describeAnswer({ choice: 'delete' })).toBe('delete')
  })

  test('reads booleans and lists as a person would', () => {
    expect(describeAnswer({ ok: true, also: false })).toBe('Yes · No')
    expect(describeAnswer({ picks: ['a', 'b'] })).toBe('a, b')
  })
})
