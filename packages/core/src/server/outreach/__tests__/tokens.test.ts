import { describe, expect, it } from 'vitest'
import { buildOutreachUrl, generateOutreachToken, hashOutreachToken } from '../tokens.js'
import { isSafeInternalPath, resolveWorkspaceTargetPath } from '../../../shared/outreach/paths.js'

describe('outreach tokens', () => {
  it('generates opaque URL-safe tokens and hashes them with the app secret', () => {
    const token = generateOutreachToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(hashOutreachToken(token, 'secret-a')).not.toBe(token)
    expect(hashOutreachToken(token, 'secret-a')).toBe(hashOutreachToken(token, 'secret-a'))
    expect(hashOutreachToken(token, 'secret-a')).not.toBe(hashOutreachToken(token, 'secret-b'))
  })

  it('builds a clean outreach URL with only the raw token path segment', () => {
    const url = buildOutreachUrl('https://app.example.com/base?x=1#frag', 'abc123')

    expect(url).toBe('https://app.example.com/o/abc123')
  })
})

describe('outreach target paths', () => {
  it('allows internal paths and rejects external redirects', () => {
    expect(isSafeInternalPath('/workspace/123')).toBe(true)
    expect(isSafeInternalPath('https://evil.test/workspace/123')).toBe(false)
    expect(isSafeInternalPath('//evil.test/workspace/123')).toBe(false)
    expect(isSafeInternalPath('workspace/123')).toBe(false)
  })

  it('resolves workspace placeholders from durable provisioned state', () => {
    expect(resolveWorkspaceTargetPath('/', 'ws_1')).toBe('/workspace/ws_1')
    expect(resolveWorkspaceTargetPath('/workspace/{workspaceId}/output/a', 'ws_1')).toBe('/workspace/ws_1/output/a')
    expect(resolveWorkspaceTargetPath('/workspace/:workspaceId/output/a', 'ws_1')).toBe('/workspace/ws_1/output/a')
  })
})
