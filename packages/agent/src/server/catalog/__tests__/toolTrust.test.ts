import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool, CatalogTool } from '../../../shared/tool'
import {
  UNTRUSTED_TOOL_EXECUTION_CODE,
  createUntrustedToolStub,
  routeCatalogForDispatch,
  routeCatalogToolForDispatch,
} from '../toolTrust'

function makeTool(name: string, execute: AgentTool['execute'] = async () => ({
  content: [{ type: 'text', text: name }],
})): AgentTool {
  return {
    name,
    description: `${name} tool`,
    promptSnippet: `use ${name}`,
    readinessRequirements: ['workspace-fs'],
    parameters: { type: 'object', properties: {} },
    execute,
  }
}

const ctx = { toolCallId: 'call', abortSignal: new AbortController().signal }

describe('routeCatalogToolForDispatch', () => {
  it('passes a trusted tool through by reference so it executes in-process unchanged', async () => {
    const tool = makeTool('read')
    const entry: CatalogTool = { trust: 'trusted', tool }

    const routed = routeCatalogToolForDispatch(entry)

    expect(routed).toBe(tool)
    const result = await routed.execute({}, ctx)
    expect(result.content[0]?.text).toBe('read')
  })

  it('replaces an untrusted tool with a stub that never runs the real handler', async () => {
    const realExecute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }))
    const tool = makeTool('scrape', realExecute)
    const entry: CatalogTool = { trust: 'untrusted', tool }

    const routed = routeCatalogToolForDispatch(entry)

    expect(routed).not.toBe(tool)
    const result = await routed.execute({ any: 'args' }, ctx)

    // The safety property: the untrusted handler must NEVER run in-process.
    expect(realExecute).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: UNTRUSTED_TOOL_EXECUTION_CODE, tool: 'scrape' })
    expect(UNTRUSTED_TOOL_EXECUTION_CODE).toBe(ErrorCode.enum.TOOL_UNTRUSTED_EXECUTION_UNSUPPORTED)
  })
})

describe('createUntrustedToolStub', () => {
  it('preserves the advertised tool surface so the model still sees the tool', () => {
    const stub = createUntrustedToolStub(makeTool('scrape'))
    expect(stub).toMatchObject({
      name: 'scrape',
      description: 'scrape tool',
      promptSnippet: 'use scrape',
      readinessRequirements: ['workspace-fs'],
      parameters: { type: 'object', properties: {} },
    })
  })

  it('returns a stable, distinguishable error rather than throwing', async () => {
    const stub = createUntrustedToolStub(makeTool('scrape'))
    const result = await stub.execute({}, ctx)
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: ErrorCode.enum.TOOL_UNTRUSTED_EXECUTION_UNSUPPORTED })
  })
})

describe('routeCatalogForDispatch', () => {
  it('routes a mixed catalog: trusted pass-through, untrusted stubbed', async () => {
    const trustedExecute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'trusted-ran' }] }))
    const untrustedExecute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'untrusted-ran' }] }))
    const catalog: CatalogTool[] = [
      { trust: 'trusted', tool: makeTool('read', trustedExecute) },
      { trust: 'untrusted', tool: makeTool('scrape', untrustedExecute) },
    ]

    const dispatchable = routeCatalogForDispatch(catalog)

    expect(dispatchable.map((tool) => tool.name)).toEqual(['read', 'scrape'])

    await dispatchable[0]!.execute({}, ctx)
    const untrustedResult = await dispatchable[1]!.execute({}, ctx)

    expect(trustedExecute).toHaveBeenCalledTimes(1)
    // No untrusted handler is ever invoked in-process.
    expect(untrustedExecute).not.toHaveBeenCalled()
    expect(untrustedResult.details).toMatchObject({ code: ErrorCode.enum.TOOL_UNTRUSTED_EXECUTION_UNSUPPORTED })
  })
})
