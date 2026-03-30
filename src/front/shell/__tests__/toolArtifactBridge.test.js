import { describe, expect, it } from 'vitest'
import { bridgeToolResultToArtifact } from '../toolArtifactBridge'

describe('toolArtifactBridge', () => {
  const activeSessionId = 'session-123'

  it('write_file with path returns shouldOpen true + code artifact', () => {
    const result = bridgeToolResultToArtifact(
      'write_file',
      { path: 'src/auth.js', content: 'export function auth() {}' },
      { success: true },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(true)
    expect(result.artifact).not.toBeNull()
    expect(result.artifact.kind).toBe('code')
    expect(result.artifact.canonicalKey).toBe('src/auth.js')
    expect(result.artifact.title).toBe('auth.js')
    expect(result.artifact.source).toBe('tool')
    expect(result.artifact.sourceSessionId).toBe(activeSessionId)
  })

  it('edit_file with path returns shouldOpen true + code artifact', () => {
    const result = bridgeToolResultToArtifact(
      'edit_file',
      { path: 'src/utils.ts', old_string: 'foo', new_string: 'bar' },
      { success: true },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(true)
    expect(result.artifact).not.toBeNull()
    expect(result.artifact.kind).toBe('code')
    expect(result.artifact.canonicalKey).toBe('src/utils.ts')
  })

  it('read_file returns shouldOpen false', () => {
    const result = bridgeToolResultToArtifact(
      'read_file',
      { path: 'src/auth.js' },
      { content: 'file contents' },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(false)
    expect(result.artifact).toBeNull()
  })

  it('bash returns shouldOpen false', () => {
    const result = bridgeToolResultToArtifact(
      'bash',
      { command: 'ls -la' },
      { stdout: 'total 0', exitCode: 0 },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(false)
    expect(result.artifact).toBeNull()
  })

  it('search_files returns shouldOpen false', () => {
    const result = bridgeToolResultToArtifact(
      'search_files',
      { pattern: 'auth', path: 'src/' },
      { matches: [] },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(false)
    expect(result.artifact).toBeNull()
  })

  it('open_file returns shouldOpen true + code artifact', () => {
    const result = bridgeToolResultToArtifact(
      'open_file',
      { path: 'src/index.jsx' },
      { success: true },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(true)
    expect(result.artifact).not.toBeNull()
    expect(result.artifact.kind).toBe('code')
    expect(result.artifact.canonicalKey).toBe('src/index.jsx')
    expect(result.artifact.title).toBe('index.jsx')
  })

  it('unknown tool returns shouldOpen false', () => {
    const result = bridgeToolResultToArtifact(
      'some_custom_tool',
      { foo: 'bar' },
      { result: 'ok' },
      activeSessionId
    )

    expect(result.shouldOpen).toBe(false)
    expect(result.artifact).toBeNull()
  })

  it('same canonicalKey produces same canonicalKey in artifact (dedup-ready)', () => {
    const result1 = bridgeToolResultToArtifact(
      'write_file',
      { path: 'src/auth.js', content: 'v1' },
      { success: true },
      activeSessionId
    )

    const result2 = bridgeToolResultToArtifact(
      'edit_file',
      { path: 'src/auth.js', old_string: 'v1', new_string: 'v2' },
      { success: true },
      activeSessionId
    )

    expect(result1.artifact.canonicalKey).toBe('src/auth.js')
    expect(result2.artifact.canonicalKey).toBe('src/auth.js')
    // Same canonical key allows the artifact controller to dedup
    expect(result1.artifact.canonicalKey).toBe(result2.artifact.canonicalKey)
    // But IDs should be different (each bridge call generates a unique ID)
    expect(result1.artifact.id).not.toBe(result2.artifact.id)
  })
})
