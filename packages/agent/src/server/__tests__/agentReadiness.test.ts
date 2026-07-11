import { describe, expect, test } from 'vitest'

import { ErrorCode } from '../../shared/error-codes'
import type { AgentTool, ToolReadinessRequirement } from '../../shared/tool'
import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from '../agentReadiness'
import { ReadyStatusTracker } from '../runtime/readyStatus'

describe('agent readiness', () => {
  test('preserves first-surviving requirement order and reports only owned facts as ready', async () => {
    const tools: AgentTool[] = [
      makeTool('read', ['workspace-fs']),
      makeTool('bash', ['sandbox-exec', 'runtime:python']),
      makeTool('grep', ['workspace-fs', 'ui-bridge']),
    ]
    const requirements = collectToolReadinessRequirements(tools)
    const tracker = new ReadyStatusTracker({
      sandboxReady: false,
      harnessReady: true,
      capabilities: {
        workspace: {
          state: 'failed',
          errorCode: ErrorCode.enum.WORKSPACE_NOT_READY,
          causeCode: 'WORKSPACE_MOUNT_FAILED',
          message: 'Workspace mount failed.',
          retryable: false,
        },
        runtimeDependencies: { state: 'not-started' },
      },
    })
    const readiness = createAgentReadinessFromTracker({
      requirements,
      tracker,
      checkReadiness: (requirement) => ({
        ready: false,
        state: 'not-started',
        workspaceId: 'workspace-a',
        message: `${requirement} has not started.`,
        retryable: true,
      }),
    })

    expect(requirements).toEqual(['workspace-fs', 'sandbox-exec', 'runtime:python', 'ui-bridge'])
    await expect(readiness.status()).resolves.toEqual([
      {
        key: 'workspace-fs',
        ready: false,
        state: 'failed',
        errorCode: ErrorCode.enum.WORKSPACE_NOT_READY,
        causeCode: 'WORKSPACE_MOUNT_FAILED',
        message: 'Workspace mount failed.',
        retryable: false,
      },
      {
        key: 'sandbox-exec',
        ready: false,
        state: 'preparing',
        errorCode: ErrorCode.enum.SANDBOX_NOT_READY,
        retryable: true,
      },
      {
        key: 'runtime:python',
        ready: false,
        state: 'not-started',
        errorCode: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
        workspaceId: 'workspace-a',
        message: 'runtime:python has not started.',
        retryable: true,
      },
      { key: 'ui-bridge', ready: false },
    ])
  })

  test.each([
    ['not-started', false, ErrorCode.enum.AGENT_RUNTIME_NOT_READY],
    ['preparing', false, ErrorCode.enum.AGENT_RUNTIME_NOT_READY],
    ['failed', false, ErrorCode.enum.RUNTIME_PROVISIONING_FAILED],
    ['ready', true, undefined],
  ] as const)('reports runtime dependency state %s as ready=%s', async (state, ready, errorCode) => {
    const tracker = new ReadyStatusTracker({
      capabilities: { runtimeDependencies: { state } },
    })
    const readiness = createAgentReadinessFromTracker({
      requirements: ['runtime-dependencies'],
      tracker,
    })

    await expect(readiness.status()).resolves.toEqual([{
      key: 'runtime-dependencies',
      ready,
      state,
      ...(errorCode ? { errorCode } : {}),
    }])
  })

  test('keeps tracker runtime state authoritative when a legacy check returns ready', async () => {
    const tracker = new ReadyStatusTracker({
      capabilities: { runtimeDependencies: { state: 'not-started' } },
    })
    const readiness = createAgentReadinessFromTracker({
      requirements: ['runtime:python'],
      tracker,
      checkReadiness: () => true,
    })

    await expect(readiness.status()).resolves.toEqual([{
      key: 'runtime:python',
      ready: false,
      state: 'not-started',
      errorCode: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
    }])
  })

  test('keeps tracker and runtime facts isolated between bindings', async () => {
    const trackerA = new ReadyStatusTracker({
      sandboxReady: true,
      capabilities: {
        workspace: { state: 'ready' },
        runtimeDependencies: { state: 'ready' },
      },
    })
    const trackerB = new ReadyStatusTracker({
      sandboxReady: false,
      capabilities: {
        workspace: { state: 'preparing', message: 'Workspace B is preparing.' },
        runtimeDependencies: { state: 'failed' },
      },
    })
    const requirements: ToolReadinessRequirement[] = ['workspace-fs', 'sandbox-exec', 'runtime:node']
    const readinessA = createAgentReadinessFromTracker({
      requirements,
      tracker: trackerA,
      checkReadiness: () => true,
    })
    const readinessB = createAgentReadinessFromTracker({
      requirements,
      tracker: trackerB,
      checkReadiness: () => ({ ready: false, state: 'failed', workspaceId: 'workspace-b' }),
    })

    await expect(readinessA.status()).resolves.toEqual([
      { key: 'workspace-fs', ready: true, state: 'ready' },
      { key: 'sandbox-exec', ready: true, state: 'ready' },
      { key: 'runtime:node', ready: true, state: 'ready' },
    ])
    await expect(readinessB.status()).resolves.toEqual([
      {
        key: 'workspace-fs',
        ready: false,
        state: 'preparing',
        errorCode: ErrorCode.enum.WORKSPACE_NOT_READY,
        message: 'Workspace B is preparing.',
      },
      {
        key: 'sandbox-exec',
        ready: false,
        state: 'preparing',
        errorCode: ErrorCode.enum.SANDBOX_NOT_READY,
        retryable: true,
      },
      {
        key: 'runtime:node',
        ready: false,
        state: 'failed',
        errorCode: ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
        workspaceId: 'workspace-b',
        retryable: true,
      },
    ])
  })
})

function makeTool(name: string, readinessRequirements: ToolReadinessRequirement[]): AgentTool {
  return {
    name,
    description: `${name} test tool.`,
    readinessRequirements,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: name }] }
    },
  }
}
