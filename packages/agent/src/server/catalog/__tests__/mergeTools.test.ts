import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool } from '../../../shared/tool'
import { mergeTools, ToolCatalogCollisionError } from '../mergeTools'

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

  it('keeps last-wins compatibility as the default collision policy for extra tools and warns', () => {
    const standardRead = makeTool('read', 'default read')
    const authoredRead = makeTool('read', 'authored read')
    const warn = vi.fn()

    const tools = mergeTools({
      standardTools: [standardRead],
      extraTools: [authoredRead],
      logger: { warn },
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'read', description: 'authored read' })
    expect(warn).toHaveBeenCalledWith('[catalog] Tool "read" overridden by extraTools')
  })

  it.each([
    ['standard/extra', { standardTools: [makeTool('bash')], extraTools: [makeTool('bash')] }],
    ['standard/plugin', { standardTools: [makeTool('bash')], pluginTools: [{ pluginName: 'shell', tools: [makeTool('bash')] }] }],
    ['extra/plugin', { standardTools: [], extraTools: [makeTool('ask_user')], pluginTools: [{ pluginName: 'ask', tools: [makeTool('ask_user')] }] }],
    ['plugin/plugin', { standardTools: [], pluginTools: [{ pluginName: 'a', tools: [makeTool('dup_tool')] }, { pluginName: 'b', tools: [makeTool('dup_tool')] }] }],
  ])('throws a frozen-code collision before merge side effects for %s collisions', (_label, options) => {
    const warn = vi.fn()
    let error: unknown

    try {
      mergeTools({
        ...options,
        logger: { warn },
        collisionPolicy: 'error',
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(ToolCatalogCollisionError)
    expect(error).toMatchObject({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION,
      field: 'tools',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('detects duplicate standard tools when collisionPolicy is error', () => {
    let error: unknown
    try {
      mergeTools({
        standardTools: [makeTool('bash'), makeTool('bash')],
        collisionPolicy: 'error',
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION,
      field: 'tools',
    })
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
