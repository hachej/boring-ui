import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertProductionAgentModeIsSafe } from '../productionSafety'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repositoryRoot = resolve(appRoot, '../..')
const dockerfilePath = resolve(appRoot, 'Dockerfile')
const mainPath = resolve(appRoot, 'src/server/main.ts')
const pluginsPath = resolve(appRoot, 'src/server/plugins.ts')
const packageJsonPath = resolve(appRoot, 'package.json')
const vitestConfigPath = resolve(appRoot, 'vitest.config.ts')
const workflowPath = resolve(repositoryRoot, '.github/workflows/self-host-full-app-image.yml')

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

  it('keeps the full-app web image as the default privilege-dropping Docker target', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8')

    expect(dockerfile).toMatch(/FROM node:22-slim AS runtime/)
    expect(dockerfile).toMatch(/boring\.role="web"/)
    expect(dockerfile).toMatch(/COPY apps\/full-app\/docker\/web-entrypoint\.sh \/usr\/local\/bin\/web-entrypoint/)
    expect(dockerfile).toMatch(/ENTRYPOINT \["\/usr\/local\/bin\/web-entrypoint"\]\nCMD \["node", "apps\/full-app\/dist\/server\/main\.js"\]/)
    expect(dockerfile.trimEnd()).toMatch(/FROM runtime AS web-runtime$/)
  })

  it('keeps the worker image explicit and privilege-dropping', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8')

    expect(dockerfile).toMatch(/FROM node:22-slim AS worker-runtime/)
    expect(dockerfile).toMatch(/boring\.role="worker"/)
    expect(dockerfile).toMatch(/mkdir -p \/data\/workspaces \\\n  && chown -R boring:boring \/data/)
    expect(dockerfile).toMatch(/CMD \["\/usr\/local\/bin\/worker-entrypoint", "node", "worker\/agent-worker\.js"\]/)
  })

  it('detaches active full-app entrypoints while retaining the historical agent-host assets', () => {
    const main = readFileSync(mainPath, 'utf8')
    const plugins = readFileSync(pluginsPath, 'utf8')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts: Record<string, string> }
    const vitestConfig = readFileSync(vitestConfigPath, 'utf8')
    const dockerfile = readFileSync(dockerfilePath, 'utf8')
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(main).not.toMatch(/\.\/deployment\//)
    expect(main).not.toMatch(/BORING_AGENT_HOST_ID|createAgentHost|startAgentHost|\bagentHost\b/)
    expect(plugins).not.toMatch(/\.\/deployment\//)
    expect(plugins).not.toMatch(/AgentHostError|AgentHostErrorCode/)
    expect(Object.keys(packageJson.scripts)).not.toContain('agent-host:revision')
    expect(Object.keys(packageJson.scripts)).not.toContainEqual(expect.stringMatching(/^proof:agent-host-/))
    expect(vitestConfig).toContain("BORING_HISTORICAL_AGENT_HOST_TESTS === '1'")
    expect(vitestConfig).toContain("['src/server/deployment/**/*.test.ts']")
    expect(dockerfile).not.toMatch(/AGENT_HOST_MIGRATION|ai\.senecapp\.agent-host/)
    expect(workflow).not.toMatch(/agent-host-migration-evidence|AGENT_HOST_MIGRATION|ai\.senecapp\.agent-host/)

    for (const path of [
      'src/server/deployment',
      'scripts/agent-host-core-proof.ts',
      'scripts/agent-host-docker-boundary-proof.ts',
      'scripts/agent-host-ingress-header-proof.ts',
      'src/server/migrate.ts',
      '../../scripts/self-host/agent-host-migration-evidence.mjs',
      '../../deploy/agent-host',
      '../../packages/core/drizzle/0018_d1_binding_admissions.sql',
      '../../packages/core/drizzle/0019_d1_destructive_publication_events.sql',
      '../../packages/core/drizzle/0020_d1_admission_execution_identity.sql',
      '../../packages/core/drizzle/0021_d1_rollback_source_provenance.sql',
      '../../packages/core/drizzle/0022_agent_host_namespace.sql',
      '../../packages/core/drizzle/meta/_journal.json',
    ]) expect(existsSync(resolve(appRoot, path))).toBe(true)
  })
})
