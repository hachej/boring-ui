import { afterEach, describe, expect, it, vi } from 'vitest'

const loadConfig = async () => {
  vi.resetModules()
  return (await import('./app.config.js')).default
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('app.config mode/profile defaults', () => {
  it('defaults to frontend mode with lightningfs data', async () => {
    vi.stubEnv('VITE_UI_PROFILE', '')
    vi.stubEnv('VITE_AGENT_MODE', '')
    vi.stubEnv('VITE_DATA_BACKEND', '')

    const cfg = await loadConfig()
    expect(cfg.mode.profile).toBe('frontend')
    expect(cfg.agents.mode).toBe('frontend')
    expect(cfg.data.backend).toBe('lightningfs')
  })

  it('supports backend profile', async () => {
    vi.stubEnv('VITE_UI_PROFILE', 'backend')
    vi.stubEnv('VITE_AGENT_MODE', '')
    vi.stubEnv('VITE_DATA_BACKEND', '')

    const cfg = await loadConfig()
    expect(cfg.mode.profile).toBe('backend')
    expect(cfg.agents.mode).toBe('backend')
    expect(cfg.data.backend).toBe('http')
  })

  it('allows explicit env override over profile defaults', async () => {
    vi.stubEnv('VITE_UI_PROFILE', 'frontend')
    vi.stubEnv('VITE_AGENT_MODE', 'backend')
    vi.stubEnv('VITE_DATA_BACKEND', 'http')

    const cfg = await loadConfig()
    expect(cfg.mode.profile).toBe('frontend')
    expect(cfg.agents.mode).toBe('backend')
    expect(cfg.data.backend).toBe('http')
  })
})
