import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool, CatalogTool } from '../../../shared/tool'
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

function names(catalog: CatalogTool[]): string[] {
  return catalog.map((entry) => entry.tool.name)
}

describe('mergeTools', () => {
  it('keeps non-colliding tools in registration order', () => {
    const catalog = mergeTools({
      standardTools: [makeTool('bash'), makeTool('read')],
      extraTools: [makeTool('reverse')],
      pluginTools: [{ pluginName: 'my-plugin', tools: [makeTool('format')] }],
    })

    expect(names(catalog)).toEqual(['bash', 'read', 'reverse', 'format'])
  })

  it('uses last-registered tool on plugin name collision and warns', () => {
    const standardBash = makeTool('bash', 'default bash')
    const pluginBash = makeTool('bash', 'plugin bash')
    const warn = vi.fn()

    const catalog = mergeTools({
      standardTools: [standardBash, makeTool('read')],
      pluginTools: [{ pluginName: 'shell-override', tools: [pluginBash] }],
      logger: { warn },
    })

    const bashTools = catalog.filter((entry) => entry.tool.name === 'bash')
    expect(bashTools).toHaveLength(1)
    expect(bashTools[0]?.tool).toMatchObject({ name: pluginBash.name, description: pluginBash.description })
    expect(warn).toHaveBeenCalledWith(
      '[catalog] Tool "bash" overridden by plugin shell-override',
    )
  })

  it('keeps last-wins compatibility as the default collision policy for extra tools and warns', () => {
    const standardRead = makeTool('read', 'default read')
    const authoredRead = makeTool('read', 'authored read')
    const warn = vi.fn()

    const catalog = mergeTools({
      standardTools: [standardRead],
      extraTools: [authoredRead],
      logger: { warn },
    })

    expect(catalog).toHaveLength(1)
    expect(catalog[0]?.tool).toMatchObject({ name: 'read', description: 'authored read' })
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
    const catalog = mergeTools({
      standardTools: [],
      pluginTools: [{ pluginName: 'plugin', tools: [pluginTool] }],
      checkReadiness: () => false,
    })

    expect(catalog[0]?.tool.readinessRequirements).toEqual(['workspace-fs'])
    const result = await catalog[0]!.tool.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
    expect(result).toMatchObject({
      isError: true,
      details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, requirement: 'workspace-fs' },
    })
    expect(result.content[0]?.text).toBe('Workspace is still preparing. Try again in a moment.')
  })

  it('does not block tools that explicitly opt out of readiness requirements', async () => {
    const pluginTool = { ...makeTool('plugin_metadata'), readinessRequirements: [] }
    const catalog = mergeTools({
      standardTools: [],
      pluginTools: [{ pluginName: 'plugin', tools: [pluginTool] }],
      checkReadiness: () => false,
    })

    const result = await catalog[0]!.tool.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
    expect(result.content[0]?.text).toBe('plugin_metadata')
  })

  it('returns runtime-not-ready details for preparing runtime requirements', async () => {
    const runtimeTool = { ...makeTool('macro_transform'), readinessRequirements: ['runtime:python' as const] }
    const catalog = mergeTools({
      standardTools: [runtimeTool],
      checkReadiness: () => ({ ready: false, state: 'preparing', workspaceId: 'workspace-a', retryable: true }),
    })

    const result = await catalog[0]!.tool.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
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
    const catalog = mergeTools({
      standardTools: [runtimeTool],
      checkReadiness: () => ({ ready: false, state: 'failed', causeCode: 'PROVISIONING_UV_INSTALL_FAILED', retryable: true }),
    })

    const result = await catalog[0]!.tool.execute({}, { toolCallId: 'call', abortSignal: new AbortController().signal })
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

    const catalog = mergeTools({
      standardTools: [makeTool('bash')],
      pluginTools: [
        { pluginName: 'plugin-a', tools: [pluginFirst] },
        { pluginName: 'plugin-b', tools: [pluginSecond] },
      ],
      logger: { warn },
    })

    const dupTools = catalog.filter((entry) => entry.tool.name === 'dup_tool')
    expect(dupTools).toHaveLength(1)
    expect(dupTools[0]?.tool).toMatchObject({ name: pluginSecond.name, description: pluginSecond.description })
    expect(warn).toHaveBeenCalledWith(
      '[catalog] Tool "dup_tool" overridden by plugin plugin-b',
    )
  })

  describe('host-assigned trust', () => {
    it('marks standard and extra tools trusted by default', () => {
      const catalog = mergeTools({
        standardTools: [makeTool('bash')],
        extraTools: [makeTool('reverse')],
      })

      expect(catalog).toEqual([
        expect.objectContaining({ trust: 'trusted' }),
        expect.objectContaining({ trust: 'trusted' }),
      ])
    })

    it('marks plugin tools trusted by default to preserve first-party behavior', () => {
      const catalog = mergeTools({
        standardTools: [],
        pluginTools: [{ pluginName: 'first-party', tools: [makeTool('format')] }],
      })

      expect(catalog[0]?.trust).toBe('trusted')
    })

    it('carries the host-declared trust level from the registration', () => {
      const catalog = mergeTools({
        standardTools: [],
        pluginTools: [{ pluginName: 'tenant-bundle', tools: [makeTool('scrape')], trust: 'untrusted' }],
      })

      expect(catalog[0]).toMatchObject({ trust: 'untrusted', tool: expect.objectContaining({ name: 'scrape' }) })
    })

    it('does not let a tool self-declare trust: the host registration wins', () => {
      // A tool object cannot influence its own trust; trust comes only from the
      // host-supplied registration. Even a tool carrying a stray `trust`-like
      // field lands untrusted when the host registers it untrusted.
      const forgedTool = { ...makeTool('exfiltrate'), trust: 'trusted' } as unknown as AgentTool
      const catalog = mergeTools({
        standardTools: [],
        pluginTools: [{ pluginName: 'tenant-bundle', tools: [forgedTool], trust: 'untrusted' }],
      })

      expect(catalog[0]?.trust).toBe('untrusted')
    })
  })
})
