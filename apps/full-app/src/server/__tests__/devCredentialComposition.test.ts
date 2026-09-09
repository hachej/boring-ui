import { beforeEach, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  buildServer: undefined as undefined | ((options: Record<string, unknown>) => Promise<unknown>),
  createCoreWorkspaceAgentServer: vi.fn(),
}))

vi.mock('@hachej/boring-core/app/server', () => ({
  appRootFromImportMeta: () => '/tmp/full-app',
  createCoreWorkspaceAgentServer: captured.createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer: vi.fn(async (options: {
    buildServer: (serverOptions: Record<string, unknown>) => Promise<unknown>
  }) => {
    captured.buildServer = options.buildServer
  }),
}))

vi.mock('@hachej/boring-core/server', () => ({
  loadConfig: vi.fn(async () => ({ appId: 'full-app-test' })),
}))

vi.mock('../plugins.js', () => ({
  createFullAppHostPluginComposition: vi.fn(async () => ({
    plugins: [],
    defaultPluginPackages: [],
    governance: {
      createMeteringSink: () => ({}),
      filterModels: undefined,
      getFilesystemBindings: () => undefined,
      pi: undefined,
    },
  })),
}))

vi.mock('../credits.js', () => ({
  buildCreditsWiring: () => ({
    meteringSink: {},
    attach: vi.fn(),
  }),
}))

vi.mock('../boringMcp.js', () => ({
  createFullAppBoringMcpAgentToolsForRequest: () => [],
  fullAppAgentSessionNamespace: () => 'session-a',
  registerFullAppBoringMcpRoutes: vi.fn(),
}))

vi.mock('../managedAgentMcp.js', () => ({
  registerFullAppManagedAgentMcpRoutes: vi.fn(),
}))

beforeEach(() => {
  captured.createCoreWorkspaceAgentServer.mockReset()
  captured.createCoreWorkspaceAgentServer.mockResolvedValue({
    auth: { api: { signInEmail: vi.fn() } },
    db: {},
    post: vi.fn(),
  })
})

test('opts the live full-app dev server into credential route composition', async () => {
  await import('../dev.js')
  expect(captured.buildServer).toBeTypeOf('function')

  await captured.buildServer!({
    appRoot: '/tmp/from-dev-harness',
    credentials: false,
  })

  expect(captured.createCoreWorkspaceAgentServer).toHaveBeenCalledWith(
    expect.objectContaining({
      appRoot: '/tmp/from-dev-harness',
      credentials: true,
    }),
  )
})
