import { describe, expect, it } from 'vitest'
import { sanitizeMarkdown, sanitizeToolOutput } from '../sanitize'

describe('sanitizeMarkdown', () => {
  it('strips script tags from HTML content', () => {
    const result = sanitizeMarkdown('<script>alert(1)</script>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('</script>')
    expect(result).not.toContain('alert(1)')
  })

  it('strips onerror event handler attributes', () => {
    const result = sanitizeMarkdown('<img onerror="alert(1)" src="x">')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('alert(1)')
  })

  it('strips javascript: href URIs', () => {
    const result = sanitizeMarkdown('<a href="javascript:void(0)">click</a>')
    expect(result).not.toContain('javascript:')
  })

  it('preserves markdown formatting characters', () => {
    const result = sanitizeMarkdown('**bold** and _italic_')
    expect(result).toContain('**bold**')
    expect(result).toContain('_italic_')
  })

  it('allows safe HTML elements', () => {
    const result = sanitizeMarkdown('<div>normal html</div>')
    expect(result).toContain('<div>')
    expect(result).toContain('normal html')
    expect(result).toContain('</div>')
  })
})

describe('sanitizeToolOutput', () => {
  it('escapes HTML tags in tool output', () => {
    const result = sanitizeToolOutput('<script>rm -rf</script>')
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;script&gt;')
    expect(result).toContain('&lt;/script&gt;')
  })

  it('escapes angle brackets in normal output', () => {
    const result = sanitizeToolOutput('normal output with <angle> brackets')
    expect(result).toContain('&lt;angle&gt;')
    expect(result).not.toContain('<angle>')
  })

  it('preserves backticks (they are safe in plaintext)', () => {
    const result = sanitizeToolOutput('back`ticks` in output')
    expect(result).toContain('back`ticks` in output')
  })

  it('returns empty string for null input', () => {
    const result = sanitizeToolOutput(null)
    expect(result).toBe('')
  })

  it('returns empty string for undefined input', () => {
    const result = sanitizeToolOutput(undefined)
    expect(result).toBe('')
  })

  it('escapes single quotes to prevent attribute breakout', () => {
    const result = sanitizeToolOutput("it's a test")
    expect(result).toBe("it&#39;s a test")
  })
})
