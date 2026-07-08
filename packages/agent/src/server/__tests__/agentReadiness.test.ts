import { describe, expect, test } from 'vitest'

import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from '../agentReadiness'
import { ReadyStatusTracker } from '../runtime/readyStatus'
import type { AgentTool } from '../../shared/tool'

describe('agent readiness data', () => {
  test('reports tracker and tool readiness by requirement', async () => {
    const tracker = new ReadyStatusTracker({
      sandboxReady: true,
      harnessReady: true,
      capabilities: {
        runtimeDependencies: {
          state: 'preparing',
          requirement: 'runtime:python',
          message: 'Installing Python dependencies.',
          retryable: true,
        },
      },
    })
    const readiness = createAgentReadinessFromTracker({
      tracker,
      requirements: ['workspace-fs', 'sandbox-exec', 'runtime:python'],
      checkReadiness: (requirement) => requirement === 'runtime:python'
        ? {
            ready: false,
            state: 'preparing',
            message: 'Installing Python dependencies.',
            workspaceId: 'workspace-a',
            retryable: true,
          }
        : true,
    })

    await expect(readiness.status()).resolves.toEqual([
      { key: 'workspace-fs', ready: true, state: 'ready' },
      { key: 'sandbox-exec', ready: true, state: 'ready' },
      {
        key: 'runtime:python',
        ready: false,
        state: 'preparing',
        message: 'Installing Python dependencies.',
        workspaceId: 'workspace-a',
        retryable: true,
      },
    ])
  })

  test('derives requirements from actual tool metadata', () => {
    const tools: AgentTool[] = [
      makeTool('read', ['workspace-fs']),
      makeTool('bash', ['sandbox-exec']),
      makeTool('python_macro', ['runtime:python']),
      makeTool('grep', ['workspace-fs']),
    ]

    expect(collectToolReadinessRequirements(tools)).toEqual([
      'workspace-fs',
      'sandbox-exec',
      'runtime:python',
    ])
  })
})

function makeTool(name: string, readinessRequirements: AgentTool['readinessRequirements']): AgentTool {
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
