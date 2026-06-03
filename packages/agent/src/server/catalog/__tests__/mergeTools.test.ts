import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
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
    expect(bashTools[0]).toMatchObject({ name: pluginBash.name, description: pluginBash.description })
    expect(warn).toHaveBeenCalledWith(
      '[catalog] Tool "bash" overridden by plugin shell-override',
    )
  })

  it('wraps plugin tools with conservative workspace readiness by default', async () => {
    const pluginTool = makeTool('plugin_default')
    const tools = mergeTools({
      standardTools: [],
      pluginTools: [{ pluginName: 'plugin', tools: [pluginTool] }],
      checkReadiness: () => false,
    })

    expect(tools[0]?.readinessRequirements).toEqual(['workspace-fs'])
    const result = await tools[0]!.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
    expect(result).toMatchObject({
      isError: true,
      details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, requirement: 'workspace-fs' },
    })
    expect(result.content[0]?.text).toBe('Workspace is still preparing. Try again in a moment.')
  })

  it('does not block tools that explicitly opt out of readiness requirements', async () => {
    const pluginTool = { ...makeTool('plugin_metadata'), readinessRequirements: [] }
    const tools = mergeTools({
      standardTools: [],
      pluginTools: [{ pluginName: 'plugin', tools: [pluginTool] }],
      checkReadiness: () => false,
    })

    const result = await tools[0]!.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
    expect(result.content[0]?.text).toBe('plugin_metadata')
  })

  it('returns runtime-not-ready details for preparing runtime requirements', async () => {
    const runtimeTool = { ...makeTool('macro_transform'), readinessRequirements: ['runtime:python' as const] }
    const tools = mergeTools({
      standardTools: [runtimeTool],
      checkReadiness: () => ({ ready: false, state: 'preparing', workspaceId: 'workspace-a', retryable: true }),
    })

    const result = await tools[0]!.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
    expect(result).toMatchObject({
      isError: true,
      details: {
        code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
        retryable: true,
        requirement: 'runtime:python',
        state: 'preparing',
        workspaceId: 'workspace-a',
      },
    })
    expect(result.content[0]?.text).toContain('Python runtime dependencies are still installing')
  })

  it('returns runtime-provisioning-failed details for failed runtime requirements', async () => {
    const runtimeTool = { ...makeTool('macro_transform'), readinessRequirements: ['runtime:python' as const] }
    const tools = mergeTools({
      standardTools: [runtimeTool],
      checkReadiness: () => ({ ready: false, state: 'failed', causeCode: 'PROVISIONING_UV_INSTALL_FAILED', retryable: true }),
    })

    const result = await tools[0]!.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
    expect(result).toMatchObject({
      isError: true,
      details: {
        code: ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
        retryable: true,
        requirement: 'runtime:python',
        state: 'failed',
        causeCode: 'PROVISIONING_UV_INSTALL_FAILED',
      },
    })
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
    expect(dupTools[0]).toMatchObject({ name: pluginSecond.name, description: pluginSecond.description })
    expect(warn).toHaveBeenCalledWith(
      '[catalog] Tool "dup_tool" overridden by plugin plugin-b',
    )
  })
})
