import { describe, expect, test } from 'vitest'
import { parseSlashCommand } from '../parser'

describe('parseSlashCommand', () => {
  test('parses command without args', () => {
    expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', args: '' })
  })

  test('parses command with args', () => {
    expect(parseSlashCommand('/model sonnet')).toEqual({ name: 'model', args: 'sonnet' })
  })

  test('parses hyphenated command names', () => {
    expect(parseSlashCommand('/open-chart GDPC1')).toEqual({ name: 'open-chart', args: 'GDPC1' })
  })

  test('trims whitespace from args', () => {
    expect(parseSlashCommand('/model   haiku  ')).toEqual({ name: 'model', args: 'haiku' })
  })

  test('returns null for regular text', () => {
    expect(parseSlashCommand('hello world')).toBeNull()
  })

  test('returns null for slash in middle of text', () => {
    expect(parseSlashCommand('try /clear command')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseSlashCommand('')).toBeNull()
  })

  test('returns null for bare slash', () => {
    expect(parseSlashCommand('/')).toBeNull()
  })

  test('handles multiline args via /s flag', () => {
    const result = parseSlashCommand('/note line1\nline2')
    expect(result).toEqual({ name: 'note', args: 'line1\nline2' })
  })
})
