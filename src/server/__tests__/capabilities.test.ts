import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import {
  buildCapabilitiesResponse,
  WORKSPACE_CAPABILITIES,
  AGENT_CAPABILITIES,
} from '../services/capabilitiesImpl.js'
import { loadConfig } from '../config.js'

describe('Capabilities constants', () => {
  it('exports workspace capability names', () => {
    expect(WORKSPACE_CAPABILITIES).toContain('workspace.files')
    expect(WORKSPACE_CAPABILITIES).toContain('workspace.exec')
    expect(WORKSPACE_CAPABILITIES).toContain('workspace.git')
    expect(WORKSPACE_CAPABILITIES).toContain('workspace.python')
  })

  it('exports agent capability names', () => {
    expect(AGENT_CAPABILITIES).toContain('agent.chat')
    expect(AGENT_CAPABILITIES).toContain('agent.tools')
  })

  it('does NOT contain legacy transport-era names', () => {
    const allCaps = [...WORKSPACE_CAPABILITIES, ...AGENT_CAPABILITIES]
    expect(allCaps).not.toContain('pty')
    expect(allCaps).not.toContain('chat_claude_code')
    expect(allCaps).not.toContain('stream')
    expect(allCaps).not.toContain('terminal')
    expect(allCaps).not.toContain('shell')
  })
})

describe('buildCapabilitiesResponse', () => {
  it('returns correct shape', () => {
    const config = loadConfig()
    const result = buildCapabilitiesResponse(config, 'bwrap')
    expect(result).toHaveProperty('version')
    expect(result).toHaveProperty('capabilities')
    expect(result).toHaveProperty('auth')
    expect(result.auth).toHaveProperty('provider')
  })

  it('returns abstract capability names for bwrap backend', () => {
    const config = loadConfig()
    const result = buildCapabilitiesResponse(config, 'bwrap')
    expect(result.capabilities['workspace.files']).toBe(true)
    expect(result.capabilities['workspace.exec']).toBe(true)
    expect(result.capabilities['workspace.git']).toBe(true)
    expect(result.capabilities['workspace.python']).toBe(true)
    expect(result.capabilities['agent.chat']).toBe(true)
    expect(result.capabilities['agent.tools']).toBe(true)
  })

  it('returns subset for lightningfs backend', () => {
    const config = loadConfig()
    const result = buildCapabilitiesResponse(config, 'lightningfs')
    expect(result.capabilities['workspace.files']).toBe(true)
    expect(result.capabilities['workspace.git']).toBe(true)
    expect(result.capabilities['workspace.exec']).toBeFalsy()
    expect(result.capabilities['workspace.python']).toBeFalsy()
  })

  it('returns subset for justbash backend', () => {
    const config = loadConfig()
    const result = buildCapabilitiesResponse(config, 'justbash')
    expect(result.capabilities['workspace.files']).toBe(true)
    expect(result.capabilities['workspace.exec']).toBe(true)
    expect(result.capabilities['workspace.git']).toBeFalsy()
  })

  it('contains NO legacy names in any backend mode', () => {
    const config = loadConfig()
    for (const backend of ['bwrap', 'lightningfs', 'justbash'] as const) {
      const result = buildCapabilitiesResponse(config, backend)
      const keys = Object.keys(result.capabilities)
      expect(keys).not.toContain('pty')
      expect(keys).not.toContain('chat_claude_code')
      expect(keys).not.toContain('stream')
      expect(keys).not.toContain('terminal')
      expect(keys).not.toContain('shell')
      expect(keys).not.toContain('claude_code')
    }
  })
})

describe('GET /api/capabilities', () => {
  it('returns Python-compatible capabilities response', async () => {
    const app = createApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('features')
    expect(body).toHaveProperty('routers')

    // Python-compat: uses legacy feature names for smoke test parity
    expect(body.features.files).toBe(true)
    expect(body.features.git).toBe(true)

    await app.close()
  })
})
