import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertProductionAgentModeIsSafe } from '../productionSafety'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repositoryRoot = resolve(appRoot, '../..')
const dockerfilePath = resolve(appRoot, 'Dockerfile')
const boringMcpPath = resolve(appRoot, 'src/server/boringMcp.ts')
const mainPath = resolve(appRoot, 'src/server/main.ts')
const managedAgentMcpPath = resolve(appRoot, 'src/server/managedAgentMcp.ts')
const pluginsPath = resolve(appRoot, 'src/server/plugins.ts')
const packageJsonPath = resolve(appRoot, 'package.json')
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
    expect(dockerfile).toMatch(/COPY --from=build \/app\/packages\/boring-bash\/dist\/ packages\/boring-bash\/dist\//)
    expect(dockerfile).toMatch(/COPY --from=build \/app\/packages\/boring-bash\/package\.json packages\/boring-bash\/package\.json/)
    expect(dockerfile).toMatch(/COPY --from=build \/app\/packages\/boring-bash\/node_modules\/ packages\/boring-bash\/node_modules\//)
    expect(dockerfile).toMatch(/mkdir -p \/data\/workspaces \\\n  && chown -R boring:boring \/data/)
    expect(dockerfile).toMatch(/CMD \["\/usr\/local\/bin\/worker-entrypoint", "node", "worker\/agent-worker\.js"\]/)
  })

  it('removes obsolete AgentHost assets while retaining immutable migrations', () => {
    const boringMcp = readFileSync(boringMcpPath, 'utf8')
    const main = readFileSync(mainPath, 'utf8')
    const managedAgentMcp = readFileSync(managedAgentMcpPath, 'utf8')
    const plugins = readFileSync(pluginsPath, 'utf8')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts: Record<string, string> }
    const dockerfile = readFileSync(dockerfilePath, 'utf8')
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(boringMcp).not.toMatch(/requestScope|AgentHost|AGENT_HOST/)
    expect(main).not.toMatch(/\.\/deployment\//)
    expect(main).not.toMatch(/BORING_AGENT_HOST_ID|createAgentHost|startAgentHost|\bagentHost\b/)
    expect(managedAgentMcp).not.toMatch(/requestScope|AgentHost|AGENT_HOST/)
    expect(plugins).not.toMatch(/\.\/deployment\//)
    expect(plugins).not.toMatch(/AgentHostError|AgentHostErrorCode/)
    expect(Object.keys(packageJson.scripts)).not.toContain('agent-host:revision')
    expect(Object.keys(packageJson.scripts)).not.toContainEqual(expect.stringMatching(/^proof:agent-host-/))
    expect(dockerfile).not.toMatch(/AGENT_HOST_MIGRATION|ai\.senecapp\.agent-host/)
    expect(dockerfile).toContain('test ! -e apps/full-app/dist/server/deployment')
    expect(workflow).not.toMatch(/agent-host-migration-evidence|AGENT_HOST_MIGRATION|ai\.senecapp\.agent-host/)
    expect(workflow.match(/test ! -e \/app\/apps\/full-app\/dist\/server\/deployment/g)).toHaveLength(2)

    for (const path of [
      'src/server/deployment',
      'scripts/agent-host-core-proof.ts',
      'scripts/agent-host-docker-boundary-proof.js',
      'scripts/agent-host-docker-boundary-proof.ts',
      'scripts/agent-host-ingress-header-proof.js',
      'scripts/agent-host-ingress-header-proof.ts',
      '../../scripts/self-host/agent-host-migration-evidence.mjs',
      '../../deploy/agent-host',
    ]) expect(existsSync(resolve(appRoot, path))).toBe(false)

    for (const path of [
      'src/server/migrate.ts',
      '../../packages/core/drizzle/0018_d1_binding_admissions.sql',
      '../../packages/core/drizzle/0019_d1_destructive_publication_events.sql',
      '../../packages/core/drizzle/0020_d1_admission_execution_identity.sql',
      '../../packages/core/drizzle/0021_d1_rollback_source_provenance.sql',
      '../../packages/core/drizzle/0022_agent_host_namespace.sql',
      '../../packages/core/drizzle/meta/_journal.json',
    ]) expect(existsSync(resolve(appRoot, path))).toBe(true)
  })
})
