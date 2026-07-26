import { beforeEach, expect, test, vi } from 'vitest'

import type { RuntimeFilesystemBinding } from '../../runtime/mode'
import { RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE } from '../../runtime/filesystemBindings'
import {
  buildAgentComposition,
  type BuildAgentCompositionInput,
} from '../buildAgentComposition'

const mocks = vi.hoisted(() => ({
  buildHarnessAgentTools: vi.fn((_bundle: unknown, _options?: unknown) => []),
  buildFilesystemAgentTools: vi.fn((_bundle: unknown, _options?: unknown) => []),
  buildUploadAgentTools: vi.fn((_bundle: unknown, _options?: unknown) => []),
  createAgentRuntimeBridge: vi.fn(),
}))

vi.mock('@hachej/boring-bash/agent', () => ({
  buildHarnessAgentTools: mocks.buildHarnessAgentTools,
  buildFilesystemAgentTools: mocks.buildFilesystemAgentTools,
  buildUploadAgentTools: mocks.buildUploadAgentTools,
}))

vi.mock('../../createAgent', () => ({
  createAgentRuntimeBridge: mocks.createAgentRuntimeBridge,
}))

const operations = {
  read: async () => ({ content: '' }),
  list: async () => ({ entries: [] }),
  find: async () => ({ paths: [] }),
  grep: async () => ({ matches: [] }),
  stat: async () => ({ isDirectory: false }),
  rejectMutation: () => { throw new Error('readonly') },
} satisfies RuntimeFilesystemBinding['operations']

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createAgentRuntimeBridge.mockReturnValue({
    agent: { dispose: vi.fn(async () => undefined) },
    getRuntime: vi.fn(async () => ({
      harness: {},
      sessionStore: {},
      service: {},
    })),
  })
})

test('Agent Host composition rejects duplicate bindings before tools or harness startup', async () => {
  const input = {
    runtimeBundle: {
      filesystemBindings: [
        { filesystem: 'agent_resources', access: 'readonly', operations },
        { filesystem: 'agent_resources', access: 'readwrite', operations },
      ],
    },
    runtimeScope: {},
    options: {},
  } as unknown as BuildAgentCompositionInput

  await expect(buildAgentComposition(input)).rejects.toMatchObject({
    code: RUNTIME_FILESYSTEM_BINDING_DUPLICATE_CODE,
    filesystem: 'agent_resources',
  })
  expect(mocks.buildHarnessAgentTools).not.toHaveBeenCalled()
  expect(mocks.buildFilesystemAgentTools).not.toHaveBeenCalled()
  expect(mocks.buildUploadAgentTools).not.toHaveBeenCalled()
  expect(mocks.createAgentRuntimeBridge).not.toHaveBeenCalled()
})

test('Agent Host tools receive one merged user binding alongside supplemental bindings', async () => {
  const hostUser = { filesystem: 'user', access: 'readwrite', operations } satisfies RuntimeFilesystemBinding
  const resource = { filesystem: 'agent_resources', access: 'readonly', operations } satisfies RuntimeFilesystemBinding
  const governanceUser = { filesystem: 'user', access: 'readonly', operations } satisfies RuntimeFilesystemBinding
  const input = {
    agent: { legacyDefault: true },
    workspaceScopeId: 'workspace-1',
    runtimeBundle: {
      workspace: { root: '/workspace' },
      filesystemBindings: [hostUser, resource],
    },
    runtimeScope: {
      identity: 'scope-1',
      environment: { workspaceRoot: '/workspace' },
      getFilesystemBindings: async () => [governanceUser],
      compatibility: {
        readyTracker: {
          getReadiness: () => ({ ready: true }),
        },
      },
    },
    options: {},
  } as unknown as BuildAgentCompositionInput

  await buildAgentComposition(input)

  expect(mocks.buildFilesystemAgentTools).toHaveBeenCalledOnce()
  const toolOptions = mocks.buildFilesystemAgentTools.mock.calls[0]?.[1] as {
    getFilesystemBindings?: (ctx: Record<string, string>) => Promise<readonly RuntimeFilesystemBinding[]>
  }
  const bindings = await toolOptions.getFilesystemBindings?.({
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    requestId: 'request-1',
  })
  expect(bindings?.map((binding) => binding.filesystem)).toEqual(['agent_resources', 'user'])
  expect(bindings?.filter((binding) => binding.filesystem === 'user')).toHaveLength(1)
  expect(bindings?.find((binding) => binding.filesystem === 'user')?.access).toBe('readonly')
})
