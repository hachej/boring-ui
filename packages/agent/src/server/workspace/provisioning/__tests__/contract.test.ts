import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '@hachej/boring-bash/agent'
import {
  provisionWorkspaceRuntime,
  type ProvisionWorkspaceRuntimeOptions,
  type RuntimeProvisioningContribution,
  type WorkspaceProvisioningAdapter,
} from '..'

interface WorkspaceServerPluginLike {
  id: string
  label?: string
  systemPrompt?: string
  skills?: Array<{ name: string; source: string | URL }>
  provisioning?: RuntimeProvisioningContribution
  routes?: unknown
  agentTools?: unknown[]
}

function createAdapter(): WorkspaceProvisioningAdapter {
  return {
    mode: 'direct',
    async exec() {},
    async resolveInstallSource(source) {
      return String(source)
    },
    workspaceFs: {
      async exists() { return false },
      async rm() {},
      async mkdir() {},
      async writeText() {},
      async readText() { return null },
      async copyFromHost() {},
    },
    getRuntimeCacheRoot() {
      return '/workspace/.boring-agent/cache'
    },
  }
}

test('accepts WorkspaceServerPlugin-like objects structurally without importing workspace types', async () => {
  const plugins: WorkspaceServerPluginLike[] = [
    {
      id: 'macro',
      label: 'Macro',
      systemPrompt: 'Use macro tools.',
      skills: [],
      provisioning: {
        templateDirs: [],
        python: [],
        nodePackages: [],
      },
      routes: {},
      agentTools: [],
    },
  ]

  const opts: ProvisionWorkspaceRuntimeOptions = {
    plugins,
    adapter: createAdapter(),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  }

  await expect(provisionWorkspaceRuntime(opts)).resolves.toMatchObject({
    env: {
      BORING_AGENT_WORKSPACE_ROOT: '/workspace',
      VIRTUAL_ENV: '/workspace/.boring-agent/venv',
    },
    pathEntries: [
      '/workspace/.boring-agent/node/node_modules/.bin',
      '/workspace/.boring-agent/venv/bin',
      '/workspace/.boring-agent/sdk/uv/bin',
    ],
    skillPaths: [
      '/workspace/.boring-agent/skills',
      '/workspace/.agents/skills',
    ],
  })
})

test('agent provisioning contract does not import workspace package types', async () => {
  const files = [
    'src/server/workspace/provisioning/types.ts',
    'src/server/workspace/provisioning/provisionWorkspaceRuntime.ts',
    'src/server/workspace/provisioning/index.ts',
  ]

  for (const file of files) {
    const source = await readFile(resolve(file), 'utf8')
    expect(source).not.toContain('@hachej/boring-workspace')
    expect(source).not.toContain('WorkspaceServerPlugin')
    expect(source).not.toContain('RuntimeProvisioningPlugin')
    expect(source).not.toContain('WorkspaceSetupPlan')
  }
})
