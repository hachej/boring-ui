import { describe, expect, test } from 'vitest'
import { extractToolUiMetadata, isToolUiMetadata, sanitizeToolUiMetadata } from '../tool-ui'

describe('tool UI metadata', () => {
  test('accepts explicit metadata shape', () => {
    const metadata = { rendererId: 'pi-subagent', displayGroup: 'agents', icon: 'bot', details: { status: 'done' } }
    expect(isToolUiMetadata(metadata)).toBe(true)
    expect(extractToolUiMetadata({ details: { ui: metadata } })).toEqual(metadata)
  })

  test('rejects malformed metadata without throwing', () => {
    expect(isToolUiMetadata({ rendererId: 123 })).toBe(false)
    expect(isToolUiMetadata([])).toBe(false)
    expect(extractToolUiMetadata(null)).toBeUndefined()
    expect(extractToolUiMetadata({ details: { ui: [] } })).toBeUndefined()
    expect(extractToolUiMetadata({ details: { ui: { rendererId: 123 } } })).toBeUndefined()
  })

  test('strips empty renderer fields while preserving renderer details', () => {
    expect(sanitizeToolUiMetadata({ rendererId: '  ', displayGroup: '', icon: ' bot ', details: { ok: true } })).toEqual({
      icon: 'bot',
      details: { ok: true },
    })
  })
})
