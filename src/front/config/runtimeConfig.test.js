import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRuntimeConfig, runtimeConfigToProviderConfig } from './runtimeConfig'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('runtimeConfigToProviderConfig', () => {
  it('flattens frontend config while keeping app, auth, and agents metadata', () => {
    const config = runtimeConfigToProviderConfig({
      app: { id: 'child-app', name: 'Child App' },
      frontend: {
        branding: { name: 'Child App', logo: 'C' },
        data: { backend: 'http' },
        panels: { chart: { component: 'chart-panel' } },
        mode: { profile: 'backend' },
      },
      agents: { mode: 'backend', available: ['pi'] },
      auth: { provider: 'neon' },
    })

    expect(config.branding.name).toBe('Child App')
    expect(config.panels.chart.component).toBe('chart-panel')
    expect(config.mode.profile).toBe('backend')
    expect(config.app.id).toBe('child-app')
    expect(config.agents.mode).toBe('backend')
    expect(config.agents.available).toEqual(['pi'])
    expect(config.auth.provider).toBe('neon')
  })
})

describe('fetchRuntimeConfig', () => {
  it('requests the canonical runtime config endpoint', async () => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:9000')
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ frontend: { branding: { name: 'Loaded' } } }),
    })

    const payload = await fetchRuntimeConfig(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9000/__bui/config', {
      credentials: 'include',
    })
    expect(payload.frontend.branding.name).toBe('Loaded')
  })

  it('keeps runtime config on the root origin when booting inside a workspace route', async () => {
    vi.stubEnv('VITE_API_URL', '')
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
        origin: 'https://example.com',
        pathname: '/w/ws-123/',
      },
    })

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ frontend: { branding: { name: 'Loaded' } } }),
    })

    try {
      await fetchRuntimeConfig(fetchImpl)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/__bui/config', {
      credentials: 'include',
    })
  })

  it('throws on non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })

    await expect(fetchRuntimeConfig(fetchImpl)).rejects.toThrow(
      'Failed to load runtime config (503)',
    )
  })
})
