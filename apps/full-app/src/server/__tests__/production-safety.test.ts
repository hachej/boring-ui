import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertProductionAgentModeIsSafe } from '../productionSafety'

const dockerfilePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../Dockerfile')

describe('production full-app safety guards', () => {
  it('rejects unset, direct, and local agent modes in production by default', () => {
    expect(() => assertProductionAgentModeIsSafe({ NODE_ENV: 'production' })).toThrow(
      /BORING_AGENT_MODE=<unset> is not allowed/,
    )

    expect(() =>
      assertProductionAgentModeIsSafe({ NODE_ENV: 'production', BORING_AGENT_MODE: 'direct' }),
    ).toThrow(/BORING_AGENT_MODE=direct is not allowed/)

    expect(() =>
      assertProductionAgentModeIsSafe({ NODE_ENV: 'production', BORING_AGENT_MODE: 'local' }),
    ).toThrow(/BORING_AGENT_MODE=local is not allowed/)
  })

  it('allows vercel-sandbox and explicit unsafe override', () => {
    expect(() =>
      assertProductionAgentModeIsSafe({ NODE_ENV: 'production', BORING_AGENT_MODE: 'vercel-sandbox' }),
    ).not.toThrow()

    expect(() =>
      assertProductionAgentModeIsSafe({
        NODE_ENV: 'production',
        BORING_AGENT_MODE: 'local',
        BORING_ALLOW_UNSAFE_AGENT_MODE: '1',
      }),
    ).not.toThrow()
  })

  it('keeps the full-app web image as the default non-root Docker target', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8')

    expect(dockerfile).toMatch(/FROM node:22-slim AS runtime/)
    expect(dockerfile).toMatch(/boring\.role="web"/)
    expect(dockerfile).toMatch(/USER boring\nCMD \["node", "apps\/full-app\/dist\/server\/main\.js"\]/)
    expect(dockerfile.trimEnd()).toMatch(/FROM runtime AS web-runtime$/)
  })

  it('keeps the worker image explicit and privilege-dropping', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8')

    expect(dockerfile).toMatch(/FROM node:22-slim AS worker-runtime/)
    expect(dockerfile).toMatch(/boring\.role="worker"/)
    expect(dockerfile).toMatch(/mkdir -p \/data\/workspaces \\\n  && chown -R boring:boring \/data/)
    expect(dockerfile).toMatch(/CMD \["\/usr\/local\/bin\/worker-entrypoint", "node", "worker\/agent-worker\.js"\]/)
  })
})
