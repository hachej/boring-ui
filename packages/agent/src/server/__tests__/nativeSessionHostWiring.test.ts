import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

async function source(path: string): Promise<string> {
  return await readFile(resolve(repositoryRoot, path), 'utf8')
}

function explicitEnableCount(contents: string): number {
  return contents.match(/nativeSessionStartEnabled:\s*true/g)?.length ?? 0
}

describe('first-party native session host wiring', () => {
  test.each([
    'apps/agent-playground/src/server/index.ts',
    'apps/full-app/scripts/remote-worker-smoke.mjs',
    'apps/full-app/src/server/dev.ts',
    'apps/full-app/src/server/main.ts',
    'apps/workspace-playground/scripts/bridge-e2e.ts',
    'apps/workspace-playground/src/eval/run.ts',
    'apps/workspace-playground/src/server/dev.ts',
    'packages/agent/examples/with-custom-tool/server.ts',
    'packages/agent/scripts/eval-provisioning-agent-vercel.mts',
    'packages/agent/scripts/eval-provisioning-agent.mts',
    'packages/agent/scripts/eval.ts',
    'packages/agent/scripts/smoke-capability-readiness-vercel.mts',
    'packages/agent/scripts/smoke-capability-readiness.mts',
    'packages/agent/src/bin/boring-agent.ts',
    'packages/agent/src/server/dev.ts',
    'plugins/bi-dashboard/playground/run-eval.ts',
    'plugins/bi-dashboard/playground/src/server.ts',
    'plugins/generated-pane/playground/run-eval.ts',
  ])('%s explicitly enables native session start', async (path) => {
    expect(explicitEnableCount(await source(path))).toBeGreaterThanOrEqual(1)
  })

  test('CLI enables both folder and registry host compositions', async () => {
    expect(explicitEnableCount(await source('packages/cli/src/server/modeApps.ts'))).toBe(2)
  })

  test('generic workspace and core composition pass the capability through without enabling it', async () => {
    expect(await source('packages/workspace/src/app/server/createWorkspaceAgentServer.ts'))
      .toMatch(/nativeSessionStartEnabled:\s*opts\.nativeSessionStartEnabled === true/)
    expect(await source('packages/core/src/app/server/createCoreWorkspaceAgentServer.ts'))
      .toMatch(/nativeSessionStartEnabled:\s*options\.nativeSessionStartEnabled === true/)
    expect(await source('packages/core/src/app/server/runServer.ts'))
      .not.toContain('nativeSessionStartEnabled')
    expect(await source('packages/core/src/app/server/devServer.ts'))
      .not.toContain('nativeSessionStartEnabled')
  })

  test('workspace playground advertises native start in remote-worker mode', async () => {
    const contents = await source('apps/workspace-playground/src/server/dev.ts')
    const serverComposition = contents.slice(
      contents.indexOf('createWorkspaceAgentServer({'),
      contents.indexOf('app.get("/api/v1/workspace/meta"'),
    )
    expect(serverComposition).toMatch(/nativeSessionStartEnabled:\s*true/)
    expect(contents).not.toContain('nativeSessionStartEnabled: !remoteWorkerModeAdapter')
  })

  test('full app enables the existing WorkspaceAgentFront native-first path', async () => {
    expect(await source('apps/full-app/src/front/main.tsx'))
      .toMatch(/\s+nativeSessionStartEnabled\s+/)
  })
})
