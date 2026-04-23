// Example sketch for the planned M5 extension API.
// This file documents target usage; runtime APIs are still landing.
//
// Intended shape:
// - createAgentApp({ extraTools: [...] })
// - mount under your app shell/server process

type ExampleTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (
    params: Record<string, unknown>,
    ctx: { toolCallId: string; abortSignal: AbortSignal },
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
}

export const reverseTool: ExampleTool = {
  name: 'reverse',
  description: 'Reverse a string.',
  parameters: {
    type: 'object',
    properties: { s: { type: 'string' } },
    required: ['s'],
  },
  async execute(params, _ctx) {
    const raw = params.s
    const input = typeof raw === 'string' ? raw : ''

    return {
      content: [{ type: 'text', text: input.split('').reverse().join('') }],
    }
  },
}

// Planned (not implemented yet):
// import type { AgentTool } from '@boring/agent/shared'
// import { createAgentApp } from '@boring/agent/server'
// const app = createAgentApp({ extraTools: [reverseTool] })
// await app.listen({ port: 3000 })
