import { expect, test, vi } from 'vitest'

import {
  assertNoSandboxPathLeaks,
  wrapToolsWithSandboxPathLeakDetector,
} from '../testing/sandboxPathLeakDetector'
import type { AgentTool } from '../../../shared/tool'

test('bwrap/local detector allows model-facing /workspace prompt and observations', () => {
  expect(() => assertNoSandboxPathLeaks({
    runtimeMode: 'local',
    sandboxProvider: 'bwrap',
    hostWorkspaceRoot: '/home/user/private/repo',
    label: 'happy prompt',
    texts: [
      'Current working directory: /workspace',
      'Observation: read /workspace/src/index.ts successfully',
    ],
  })).not.toThrow()
})

test('bwrap/local detector fails deliberate host workspace root leaks', () => {
  expect(() => assertNoSandboxPathLeaks({
    runtimeMode: 'local',
    sandboxProvider: 'bwrap',
    hostWorkspaceRoot: '/home/user/private/repo',
    label: 'system prompt',
    text: 'Current working directory: /home/user/private/repo',
  })).toThrow(/Sandbox path leak detected.*host workspace root/)
})

test('Vercel detector allows /workspace and fails deliberate /vercel/sandbox leaks', () => {
  expect(() => assertNoSandboxPathLeaks({
    runtimeMode: 'vercel-sandbox',
    label: 'happy vercel observation',
    text: 'Command completed in /workspace',
  })).not.toThrow()

  expect(() => assertNoSandboxPathLeaks({
    runtimeMode: 'vercel-sandbox',
    label: 'vercel observation',
    text: 'Command completed in /vercel/sandbox/workspace',
  })).toThrow(/Sandbox path leak detected.*internal sandbox root/)
})

test('direct mode permits host paths', () => {
  expect(() => assertNoSandboxPathLeaks({
    runtimeMode: 'direct',
    sandboxProvider: 'direct',
    hostWorkspaceRoot: '/home/user/repo',
    label: 'direct prompt',
    text: 'Current working directory: /home/user/repo',
  })).not.toThrow()
})

test('tool wrapper checks prompt snippets, streaming observations, and final observations', async () => {
  const leakingTool: AgentTool = {
    name: 'leaking_tool',
    description: 'safe description',
    promptSnippet: 'Use paths below /workspace',
    parameters: { type: 'object' },
    async execute(_params, ctx) {
      ctx.onUpdate?.('partial output from /workspace')
      return { content: [{ type: 'text', text: 'host path /home/user/private/repo leaked' }] }
    },
  }

  const [tool] = wrapToolsWithSandboxPathLeakDetector([leakingTool], {
    sandboxProvider: 'bwrap',
    hostWorkspaceRoot: '/home/user/private/repo',
  })

  await expect(tool.execute({}, {
    abortSignal: new AbortController().signal,
    toolCallId: 'tool-call',
    onUpdate: vi.fn(),
  })).rejects.toThrow(/Sandbox path leak detected.*tool leaking_tool observation/)
})

test('tool wrapper fails prompt snippet leaks before execution', () => {
  const tool: AgentTool = {
    name: 'prompt_leak',
    description: 'Reads files from /vercel/sandbox/workspace',
    parameters: { type: 'object' },
    async execute() { return { content: [{ type: 'text', text: 'ok' }] } },
  }

  expect(() => wrapToolsWithSandboxPathLeakDetector([tool], {
    sandboxProvider: 'vercel-sandbox',
  })).toThrow(/Sandbox path leak detected.*tool prompt_leak prompt/)
})
