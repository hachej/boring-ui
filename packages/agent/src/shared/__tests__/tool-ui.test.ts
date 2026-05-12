import { describe, expect, test } from 'vitest'
import { extractToolUiMetadata, isToolUiMetadata } from '../tool-ui'

describe('tool UI metadata', () => {
  test('accepts explicit metadata shape', () => {
    const metadata = { rendererId: 'pi-subagent', displayGroup: 'agents', icon: 'bot', details: { status: 'done' } }
    expect(isToolUiMetadata(metadata)).toBe(true)
    expect(extractToolUiMetadata({ details: { ui: metadata } })).toEqual(metadata)
  })

  test('supports uiKind compatibility shape', () => {
    const details = { uiKind: 'pi-subagent', task: 'inspect auth', status: 'done' }
    expect(extractToolUiMetadata({ details })).toEqual({ rendererId: 'pi-subagent', details })
  })

  test('rejects malformed metadata without throwing', () => {
    expect(isToolUiMetadata({ rendererId: 123 })).toBe(false)
    expect(extractToolUiMetadata(null)).toBeUndefined()
    expect(extractToolUiMetadata({ details: { ui: { rendererId: 123 } } })).toBeUndefined()
  })
})
