import { afterEach, describe, expect, it, vi } from 'vitest'

const loadConfig = async () => {
  vi.resetModules()
  return (await import('./app.config.js')).default
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('app.config mode/profile defaults', () => {
  it('defaults core mode to pi + lightningfs profile', async () => {
    vi.stubEnv('VITE_DEPLOY_MODE', 'core')
    vi.stubEnv('VITE_UI_PROFILE', '')
    vi.stubEnv('VITE_AGENT_RAIL_MODE', '')
    vi.stubEnv('VITE_DATA_BACKEND', '')

    const cfg = await loadConfig()
    expect(cfg.mode.deployMode).toBe('core')
    expect(cfg.mode.profile).toBe('pi-lightningfs')
    expect(cfg.features.agentRailMode).toBe('pi')
    expect(cfg.data.backend).toBe('lightningfs')
  })

  it('defaults edge mode to companion + http profile', async () => {
    vi.stubEnv('VITE_DEPLOY_MODE', 'edge')
    vi.stubEnv('VITE_UI_PROFILE', '')
    vi.stubEnv('VITE_AGENT_RAIL_MODE', '')
    vi.stubEnv('VITE_DATA_BACKEND', '')

    const cfg = await loadConfig()
    expect(cfg.mode.deployMode).toBe('edge')
    expect(cfg.mode.profile).toBe('companion-httpfs')
    expect(cfg.features.agentRailMode).toBe('companion')
    expect(cfg.data.backend).toBe('http')
  })

  it('supports pi-cheerpx profile', async () => {
    vi.stubEnv('VITE_UI_PROFILE', 'pi-cheerpx')
    vi.stubEnv('VITE_AGENT_RAIL_MODE', '')
    vi.stubEnv('VITE_DATA_BACKEND', '')

    const cfg = await loadConfig()
    expect(cfg.mode.profile).toBe('pi-cheerpx')
    expect(cfg.features.agentRailMode).toBe('pi')
    expect(cfg.data.backend).toBe('cheerpx')
  })

  it('allows explicit env override over profile defaults', async () => {
    vi.stubEnv('VITE_UI_PROFILE', 'pi-lightningfs')
    vi.stubEnv('VITE_AGENT_RAIL_MODE', 'pi')
    vi.stubEnv('VITE_DATA_BACKEND', 'http')

    const cfg = await loadConfig()
    expect(cfg.mode.profile).toBe('pi-lightningfs')
    expect(cfg.features.agentRailMode).toBe('pi')
    expect(cfg.data.backend).toBe('http')
  })
})
