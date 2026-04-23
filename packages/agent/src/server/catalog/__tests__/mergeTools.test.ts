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

  it('uses later plugin when two plugins register the same tool name', () => {
    const pluginFirst = makeTool('dup_tool', 'first plugin impl')
    const pluginSecond = makeTool('dup_tool', 'second plugin impl')
    const warn = vi.fn()

    const tools = mergeTools({
      standardTools: [makeTool('bash')],
      pluginTools: [
        { pluginName: 'plugin-a', tools: [pluginFirst] },
        { pluginName: 'plugin-b', tools: [pluginSecond] },
      ],
      logger: { warn },
    })

    const dupTools = tools.filter((tool) => tool.name === 'dup_tool')
    expect(dupTools).toHaveLength(1)
    expect(dupTools[0]).toBe(pluginSecond)
    expect(warn).toHaveBeenCalledWith(
      '[catalog] Tool "dup_tool" overridden by plugin plugin-b',
    )
  })
})
