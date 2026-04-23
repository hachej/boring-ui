import { describe, expect, test } from 'vitest'
import {
  readComposerPreferences,
  shouldSendOnEnter,
  toComposerSendInput,
} from '../Composer'

describe('Composer keyboard behavior', () => {
  test('Enter submits when not composing and shift is not pressed', () => {
    expect(
      shouldSendOnEnter({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true)
  })

  test('Shift+Enter does not submit (newline path)', () => {
    expect(
      shouldSendOnEnter({
        key: 'Enter',
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false)
  })
})

describe('Composer send payload', () => {
  test('model and thinking changes flow into next send body', () => {
    const payload = toComposerSendInput({
      message: 'run tests',
      model: 'opus',
      thinkingLevel: 'high',
    })

    expect(payload).toEqual({
      message: 'run tests',
      model: {
        provider: 'anthropic',
        id: 'opus',
      },
      thinkingLevel: 'high',
    })
  })
})

describe('Composer local-storage defaults', () => {
  test('reads model and thinking defaults from storage', () => {
    const storage = {
      getItem(key: string) {
        if (key.endsWith(':model')) return 'haiku'
        if (key.endsWith(':thinking')) return 'medium'
        return null
      },
      setItem() {},
    }

    expect(readComposerPreferences(storage)).toEqual({
      model: 'haiku',
      thinkingLevel: 'medium',
    })
  })

  test('falls back to safe defaults when storage values are invalid', () => {
    const storage = {
      getItem(_key: string) {
        return 'invalid'
      },
      setItem() {},
    }

    expect(readComposerPreferences(storage)).toEqual({
      model: 'sonnet',
      thinkingLevel: 'off',
    })
  })
})
