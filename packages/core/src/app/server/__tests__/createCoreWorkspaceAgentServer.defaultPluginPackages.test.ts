import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import { mocks } from './createCoreWorkspaceAgentServer.testHarness.js'

const PLUGIN_PACKAGE = '@hachej/boring-fixture-plugin'

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
})

/**
 * Regression: production hosts chdir away from the app directory before
 * `node dist/server/main.js` (the full-app e2e webserver runs from a mktemp
 * config dir). Plugin package names must still resolve through the *app's*
 * node_modules, so the host app root has to be threaded in as `anchorDir`.
 */
test('resolves defaultPluginPackages against the app root when cwd is elsewhere', async () => {
  const appRoot = await mkdtemp(join(tmpdir(), 'boring-core-app-root-'))
  const packageDir = join(appRoot, 'node_modules', PLUGIN_PACKAGE)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(appRoot, 'package.json'), JSON.stringify({ name: 'fixture-app' }))
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: PLUGIN_PACKAGE, boring: {} }))

  // Somewhere with no node_modules at all — the pre-fix cwd-only anchor.
  const elsewhere = await mkdtemp(join(tmpdir(), 'boring-core-cwd-'))
  process.chdir(elsewhere)

  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  // The harness mocks this module, so reach for the real resolver explicitly.
  const { resolveDefaultWorkspacePluginPackagePaths } = await vi.importActual<
    typeof import('@hachej/boring-workspace/app/server')
  >('@hachej/boring-workspace/app/server')
  mocks.resolveDefaultWorkspacePluginPackagePaths.mockImplementation(
    resolveDefaultWorkspacePluginPackagePaths as (options: unknown) => string[],
  )

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({
      defaultAgentTypeId: 'general',
      stores: 'postgres',
      databaseUrl: 'postgres://test',
    }),
    agents: [{ agentTypeId: 'general', definition: { label: 'General', instructions: 'Answer.' } }],
    appRoot,
    defaultPluginPackages: [PLUGIN_PACKAGE],
    workspaceRoot: join(elsewhere, 'workspaces'),
    serveFrontend: false,
  })
  try {
    expect(mocks.resolveDefaultWorkspacePluginPackagePaths).toHaveBeenCalledWith(
      expect.objectContaining({ anchorDir: appRoot, defaultPluginPackages: [PLUGIN_PACKAGE] }),
    )
    expect(mocks.resolveDefaultWorkspacePluginPackagePaths).toHaveReturnedWith([packageDir])
  } finally {
    await app.close()
  }
}, 30_000)
