import { describe, expect, test } from 'vitest'
import type { AgentTool } from '@hachej/boring-agent/shared'

import { createStageBus } from '../stageBus'
import { createStageTools } from '../stageTools'

function tool(tools: readonly AgentTool[], name: string): AgentTool {
  return tools.find((candidate) => candidate.name === name)!
}

describe('screen tools', () => {
  test('shows app or page, returns to app, and clears to chat', async () => {
    const bus = createStageBus()
    const events: unknown[] = []
    bus.subscribe((event) => events.push(event))
    const tools = createStageTools({
      bus,
      appBaseUrl: 'http://localhost:6100/',
      allowedOrigins: ['http://localhost:*'],
    })

    await tool(tools, 'show_on_screen').execute({ what: 'page', url: 'http://localhost:6100/sketch', title: 'Sketch' }, {} as never)
    await tool(tools, 'back_to_app').execute({}, {} as never)
    await tool(tools, 'clear_screen').execute({}, {} as never)

    expect(events).toEqual([
      { type: 'stage.show', what: 'page', url: 'http://localhost:6100/sketch', title: 'Sketch', label: 'preview' },
      { type: 'stage.show', what: 'app', url: 'http://localhost:6100/', title: 'Your app' },
      { type: 'stage.clear' },
    ])
  })
})
