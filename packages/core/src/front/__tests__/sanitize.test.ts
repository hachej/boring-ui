// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeMarkdown, sanitizeToolOutput } from '../sanitize'

describe('sanitizeMarkdown', () => {
  it('strips script tags', () => {
    const input = '<p>Hello</p><script>alert("xss")</script>'
    const result = sanitizeMarkdown(input)
    expect(result).toContain('<p>Hello</p>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
  })

  it('preserves allowed tags', () => {
    const input = '<h1>Title</h1><p>Text with <strong>bold</strong> and <em>italic</em></p>'
    expect(sanitizeMarkdown(input)).toBe(input)
  })

  it('preserves links with href', () => {
    const input = '<a href="https://example.com">link</a>'
    expect(sanitizeMarkdown(input)).toContain('href="https://example.com"')
  })

  it('strips event handlers', () => {
    const input = '<p onclick="alert(1)">click me</p>'
    const result = sanitizeMarkdown(input)
    expect(result).not.toContain('onclick')
  })

  it('strips data attributes', () => {
    const input = '<div data-evil="payload">content</div>'
    const result = sanitizeMarkdown(input)
    expect(result).not.toContain('data-evil')
  })
})

describe('sanitizeToolOutput', () => {
  it('allows code and pre tags', () => {
    const input = '<pre><code>console.log("hi")</code></pre>'
    expect(sanitizeToolOutput(input)).toBe(input)
  })

  it('strips dangerous tags', () => {
    const input = '<div><iframe src="evil"></iframe><code>safe</code></div>'
    const result = sanitizeToolOutput(input)
    expect(result).not.toContain('<iframe')
    expect(result).toContain('<code>safe</code>')
  })

  it('strips links from tool output', () => {
    const input = '<a href="https://evil.com">click</a>'
    const result = sanitizeToolOutput(input)
    expect(result).not.toContain('<a')
  })
})
