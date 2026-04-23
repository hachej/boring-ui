import { describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '../../../shared/tool'
import { mergeTools } from '../mergeTools'

function makeTool(name: string, description = `${name} tool`): AgentTool {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: name }] }
    },
  }
}

describe('mergeTools', () => {
  it('keeps non-colliding tools in registration order', () => {
    const tools = mergeTools({
      standardTools: [makeTool('bash'), makeTool('read')],
      extraTools: [makeTool('reverse')],
      pluginTools: [{ pluginName: 'my-plugin', tools: [makeTool('format')] }],
    })

    expect(tools.map((tool) => tool.name)).toEqual([
      'bash',
      'read',
      'reverse',
      'format',
    ])
  })

  it('uses last-registered tool on plugin name collision and warns', () => {
    const standardBash = makeTool('bash', 'default bash')
    const pluginBash = makeTool('bash', 'plugin bash')
    const warn = vi.fn()

    const tools = mergeTools({
      standardTools: [standardBash, makeTool('read')],
      pluginTools: [{ pluginName: 'shell-override', tools: [pluginBash] }],
      logger: { warn },
    })

    const bashTools = tools.filter((tool) => tool.name === 'bash')
    expect(bashTools).toHaveLength(1)
    expect(bashTools[0]).toBe(pluginBash)
    expect(warn).toHaveBeenCalledWith(
      '[catalog] Tool "bash" overridden by plugin shell-override',
    )
  })
})
