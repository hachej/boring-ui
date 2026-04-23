import type { AgentTool } from '../../src/shared/tool'
import { createAgentApp } from '../../src/server/createAgentApp'

const reverseTool: AgentTool = {
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

const app = await createAgentApp({
  extraTools: [reverseTool],
  mode: 'direct',
})

await app.listen({ port: 3000 })
console.log('Agent running on http://localhost:3000')
