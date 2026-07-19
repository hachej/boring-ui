import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AgentDefinitionValidationError,
} from '../../../shared/agent-definition'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool, ToolReadinessRequirement } from '../../../shared/tool'
import {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
  type MaterializedAgentSourceV1,
} from '../../index'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix = 'boring-authored-agent-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    definitionId: 'claims-assistant',
    version: '2026.07.18',
    label: 'Claims assistant',
    instructionsRef: 'instructions.md',
    ...overrides,
  }
}

async function writeAgentDirectory(
  directory: string,
  input: {
    manifest?: Record<string, unknown>
    instructions?: string
  } = {},
): Promise<void> {
  await writeFile(
    join(directory, 'agent.json'),
    JSON.stringify(input.manifest ?? definition()),
    'utf8',
  )
  await writeFile(
    join(directory, 'instructions.md'),
    input.instructions ?? 'Handle claims with care.',
    'utf8',
  )
}

function makeTool(name: string, overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: name }] }
    },
    ...overrides,
  }
}

const SECRET_THROW = new Error('ESECRET /private/agent/tool.ts')

function throwingProxy<T extends object>(): T {
  return new Proxy(Object.create(null), {
    get() { throw SECRET_THROW },
    getOwnPropertyDescriptor() { throw SECRET_THROW },
    getPrototypeOf() { throw SECRET_THROW },
    has() { throw SECRET_THROW },
    ownKeys() { throw SECRET_THROW },
  }) as T
}

function revokedProxy<T extends object>(target: T): T {
  const { proxy, revoke } = Proxy.revocable(target, {})
  revoke()
  return proxy
}

function expectRedactedMaterializationError(
  error: unknown,
  expected: Partial<AuthoredAgentMaterializationError>,
): void {
  expect(error).toMatchObject({
    name: 'AuthoredAgentMaterializationError',
    ...expected,
  })
  expect(error).toBeInstanceOf(AuthoredAgentMaterializationError)
  expect(error).not.toBe(SECRET_THROW)
  expect((error as Error).message).not.toContain('ESECRET')
  expect((error as Error).message).not.toContain('/private')
}

async function expectMaterializeRejectsRedacted(
  input: Parameters<typeof materializeAgentDirectory>[0],
  expected: Partial<AuthoredAgentMaterializationError>,
): Promise<void> {
  let error: unknown
  try {
    await materializeAgentDirectory(input)
  } catch (caught) {
    error = caught
  }
  expectRedactedMaterializationError(error, expected)
}

describe('materializeAgentDirectory', () => {
  it('returns the frozen server-only authored source for a ref-free directory', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { instructions: 'Exact authored prompt.' })

    const catalog = new Map([['unused.tool', makeTool('unused_tool')]])
    const get = vi.spyOn(catalog, 'get')

    const source: MaterializedAgentSourceV1 = await materializeAgentDirectory({
      directory: root,
      expectedAgentTypeId: 'claims-assistant',
      toolCatalog: catalog,
    })

    expect(source).toEqual({
      schemaVersion: 1,
      agentTypeId: 'claims-assistant',
      version: '2026.07.18',
      label: 'Claims assistant',
      instructions: 'Exact authored prompt.',
      tools: [],
      declaredToolRefs: [],
    })
    expect(Object.keys(source).sort()).toEqual([
      'agentTypeId',
      'declaredToolRefs',
      'instructions',
      'label',
      'schemaVersion',
      'tools',
      'version',
    ])
    expect(JSON.stringify(source)).not.toMatch(/definitionDigest|digest|assets|path|root|catalog|runtime|toolCatalog/)
    expect(Object.isFrozen(source)).toBe(true)
    expect(Object.isFrozen(source.tools)).toBe(true)
    expect(Object.isFrozen(source.declaredToolRefs)).toBe(true)
    expect(get).not.toHaveBeenCalled()
    expect(() => (source.tools as AgentTool[]).push(makeTool('late_tool'))).toThrow(TypeError)
    expect(() => (source.declaredToolRefs as string[]).push('late.ref')).toThrow(TypeError)
    expect(() => ((source as { version: string }).version = 'changed')).toThrow(TypeError)
  })

  it('keeps optional label omitted and freezes empty declared refs from authored empty arrays', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({
        label: undefined,
        toolRefs: [],
        capabilityRequirements: [],
        skillRefs: [],
        mcpServerRefs: [],
      }),
    })

    const source = await materializeAgentDirectory({ directory: root })

    expect(source).toEqual({
      schemaVersion: 1,
      agentTypeId: 'claims-assistant',
      version: '2026.07.18',
      instructions: 'Handle claims with care.',
      tools: [],
      declaredToolRefs: [],
    })
    expect('label' in source).toBe(false)
    expect(Object.isFrozen(source.declaredToolRefs)).toBe(true)
  })

  it.each([
    ['definitionId', 'ClaimsAssistant'],
    ['definitionId', '1claims-assistant'],
    ['definitionId', 'claims_assistant'],
    ['definitionId', `a${'b'.repeat(63)}`],
    ['expectedAgentTypeId', 'ClaimsAssistant'],
  ])('rejects invalid product agent type id in %s', async (field, value) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition(field === 'definitionId' ? { definitionId: value } : {}),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      ...(field === 'expectedAgentTypeId' ? { expectedAgentTypeId: value } : {}),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_ID_INVALID,
      field,
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('rejects expected agent type mismatches before returning behavior', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root)

    await expect(materializeAgentDirectory({
      directory: root,
      expectedAgentTypeId: 'other-agent',
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TYPE_MISMATCH,
      field: 'expectedAgentTypeId',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('resolves trusted authored tool refs exactly once in declaration order', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['quotes.compare', 'quotes.summarize'] }),
    })
    const compareExecute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'compare' }] }))
    const catalog = new Map([
      ['quotes.summarize', makeTool('summarize_quotes')],
      ['quotes.compare', makeTool('compare_quotes', { execute: compareExecute })],
    ])
    const get = vi.spyOn(catalog, 'get')

    const source = await materializeAgentDirectory({ directory: root, toolCatalog: catalog })

    expect(source.declaredToolRefs).toEqual(['quotes.compare', 'quotes.summarize'])
    expect(source.tools.map((tool) => tool.name)).toEqual(['compare_quotes', 'summarize_quotes'])
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(1, 'quotes.compare')
    expect(get).toHaveBeenNthCalledWith(2, 'quotes.summarize')
    expect(compareExecute).not.toHaveBeenCalled()
  })

  it('requires a trusted server catalog for non-empty authored tool refs', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_CATALOG_REQUIRED,
      field: 'toolRefs',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('rejects unknown authored tool refs without disclosing ref values', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    let error: unknown
    try {
      await materializeAgentDirectory({
        directory: root,
        toolCatalog: new Map([['other.ref', makeTool('private_tool')]]),
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNKNOWN,
      field: 'toolRefs[0]',
    } satisfies Partial<AuthoredAgentMaterializationError>)
    expect((error as Error).message).not.toContain('private.catalog.ref')
    expect((error as Error).message).not.toContain('private_tool')
  })

  it.each([
    ['throwing catalog get', new Proxy(new Map<string, AgentTool>(), { get() { throw SECRET_THROW } })],
    ['revoked catalog', revokedProxy(new Map<string, AgentTool>())],
    ['forged materialization error', new Map([['private.catalog.ref', makeTool('valid_tool')]])],
  ])('redacts %s failures as catalog invalid', async (testCase, toolCatalog) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    const catalog = testCase === 'forged materialization error'
      ? new Proxy(toolCatalog as Map<string, AgentTool>, {
          get(target, property, receiver) {
            if (property === 'get') {
              return () => {
                throw new AuthoredAgentMaterializationError({
                  code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION,
                  field: 'forged.secret',
                  message: 'ESECRET /private/forged',
                })
              }
            }
            return Reflect.get(target, property, receiver)
          },
        })
      : toolCatalog

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: catalog as unknown as ReadonlyMap<string, AgentTool>,
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_CATALOG_INVALID,
      field: 'toolRefs[0]',
    })
  })

  it.each([
    ['throwing tool object', throwingProxy<AgentTool>()],
    ['revoked tool object', revokedProxy(makeTool('valid_tool'))],
  ])('redacts %s reflection failures as invalid authored tools', async (_case, tool) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([['private.catalog.ref', tool]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].name',
    })
  })

  it.each([
    ['name', makeTool('unsafe.name')],
    ['description', makeTool('valid_tool', { description: '   ' })],
    ['parameters', makeTool('valid_tool', { parameters: [] as unknown as AgentTool['parameters'] })],
    ['readinessRequirements', makeTool('valid_tool', { readinessRequirements: ['workspace-fs', 'runtime:python', 'not-real'] as ToolReadinessRequirement[] })],
    ['execute', { ...makeTool('valid_tool'), execute: undefined } as unknown as AgentTool],
  ])('rejects invalid authored tool %s with the frozen invalid-tool code', async (_case, tool) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([['private.catalog.ref', tool]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it.each([
    ['name'],
    ['description'],
    ['parameters'],
    ['execute'],
  ])('rejects accessor authored tool field %s without invoking the getter', async (property) => {
    const root = await makeTempDir()
    const tool = makeTool('valid_tool') as unknown as Record<string, unknown>
    let getterCalls = 0
    Object.defineProperty(tool, property, {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error('getter must not be invoked')
      },
    })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([['private.catalog.ref', tool as unknown as AgentTool]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: `toolRefs[0].${property}`,
    } satisfies Partial<AuthoredAgentMaterializationError>)
    expect(getterCalls).toBe(0)
  })

  it('snapshots validated authored tool fields before freezing output', async () => {
    const root = await makeTempDir()
    const tool = makeTool('valid_tool')
    const originalExecute = tool.execute
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })
    const catalog = new Map([['private.catalog.ref', tool]])
    const get = vi.spyOn(catalog, 'get').mockImplementation((ref) => {
      const value = Map.prototype.get.call(catalog, ref) as AgentTool | undefined
      if (value) {
        value.name = 'mutated_after_lookup'
        value.execute = async () => ({ content: [{ type: 'text', text: 'mutated' }] })
      }
      return value === undefined
        ? undefined
        : makeTool('valid_tool', { execute: originalExecute })
    })

    const source = await materializeAgentDirectory({ directory: root, toolCatalog: catalog })

    expect(get).toHaveBeenCalledTimes(1)
    expect(source.tools[0]!.name).toBe('valid_tool')
    expect(source.tools[0]!.execute).toBe(originalExecute)
  })

  it('rejects non-string prompt snippets with the invalid-tool code and promptSnippet field', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { promptSnippet: 123 as unknown as string }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].promptSnippet',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('rejects sparse readiness arrays with the invalid-tool code and readiness field', async () => {
    const root = await makeTempDir()
    const sparseReadiness = [] as unknown[]
    sparseReadiness.length = 1
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { readinessRequirements: sparseReadiness as ToolReadinessRequirement[] }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].readinessRequirements',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('copies readiness requirements without using a custom iterator', async () => {
    const root = await makeTempDir()
    const readiness = ['workspace-fs'] as ToolReadinessRequirement[]
    Object.defineProperty(readiness, Symbol.iterator, {
      value() {
        throw new Error('iterator must not be called')
      },
    })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    const source = await materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { readinessRequirements: readiness }),
      ]]),
    })

    expect(source.tools[0]!.readinessRequirements).toEqual(['workspace-fs'])
  })

  it('rejects accessor readiness indexes without invoking them', async () => {
    const root = await makeTempDir()
    const readiness = [] as unknown[]
    readiness.length = 1
    let getterCalls = 0
    Object.defineProperty(readiness, 0, {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error('getter must not be invoked')
      },
    })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { readinessRequirements: readiness as ToolReadinessRequirement[] }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].readinessRequirements',
    } satisfies Partial<AuthoredAgentMaterializationError>)
    expect(getterCalls).toBe(0)
  })

  it.each([
    ['throwing readiness array', new Proxy(['workspace-fs'], { get() { throw SECRET_THROW } })],
    ['revoked readiness array', revokedProxy(['workspace-fs'])],
    ['throwing readiness descriptor', new Proxy(['workspace-fs'], { getOwnPropertyDescriptor() { throw SECRET_THROW } })],
  ])('redacts %s failures as invalid readiness requirements', async (_case, readiness) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { readinessRequirements: readiness as ToolReadinessRequirement[] }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].readinessRequirements',
    })
  })

  it('redacts invalid proxied readiness items', async () => {
    const root = await makeTempDir()
    const readiness = [throwingProxy<object>()] as unknown as ToolReadinessRequirement[]
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { readinessRequirements: readiness }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].readinessRequirements',
    })
  })

  it.each([
    ['10,005 length readiness proxy', 10_005],
    ['MAX_SAFE length readiness proxy', Number.MAX_SAFE_INTEGER],
  ])('rejects %s before iteration or allocation', async (_case, length) => {
    const root = await makeTempDir()
    let ownChecks = 0
    const readiness = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') return length
        return Reflect.get(target, property, receiver)
      },
      getOwnPropertyDescriptor() {
        throw SECRET_THROW
      },
      has() {
        ownChecks += 1
        throw SECRET_THROW
      },
    }) as unknown as ToolReadinessRequirement[]
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { readinessRequirements: readiness }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].readinessRequirements',
    })
    expect(ownChecks).toBe(0)
  })

  it.each([
    ['undefined', { type: 'object', properties: { value: undefined } }],
    ['function', { type: 'object', properties: { value: () => undefined } }],
    ['symbol', { type: 'object', properties: { value: Symbol('private') } }],
    ['bigint', { type: 'object', properties: { value: 1n } }],
    ['NaN', { type: 'object', properties: { value: Number.NaN } }],
    ['Infinity', { type: 'object', properties: { value: Number.POSITIVE_INFINITY } }],
    ['non-plain object', { type: 'object', properties: { value: new Date(0) } }],
  ])('rejects invalid JSON schema parameter value %s with the parameters field', async (_case, schema) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: schema }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('rejects generative parameter proxies with the parameters field instead of overflowing', async () => {
    const root = await makeTempDir()
    const generative = new Proxy(Object.create(null), {
      ownKeys() { return ['next'] },
      getOwnPropertyDescriptor(_target, property) {
        if (property === 'next') {
          return {
            value: new Proxy(Object.create(null), this),
            enumerable: true,
            configurable: true,
            writable: true,
          }
        }
        return undefined
      },
      getPrototypeOf() { return null },
    }) as Record<string, unknown>
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: generative as AgentTool['parameters'] }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    })
  })

  it('rejects overdeep parameter schemas with the parameters field instead of overflowing', async () => {
    const root = await makeTempDir()
    let schema: Record<string, unknown> = { type: 'object' }
    for (let index = 0; index < 110; index += 1) {
      schema = { next: schema }
    }
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: schema as AgentTool['parameters'] }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    })
  })

  it('rejects overwide parameter schemas with the parameters field', async () => {
    const root = await makeTempDir()
    const schema: Record<string, unknown> = { type: 'object' }
    for (let index = 0; index < 10_005; index += 1) {
      schema[`k${index}`] = index
    }
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: schema as AgentTool['parameters'] }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    })
  })

  it.each([
    ['throwing parameters object', throwingProxy<Record<string, unknown>>()],
    ['revoked parameters object', revokedProxy({ type: 'object' })],
    ['throwing nested parameters object', { type: 'object', properties: throwingProxy<Record<string, unknown>>() }],
    ['revoked nested parameters object', { type: 'object', properties: revokedProxy({ claimId: { type: 'string' } }) }],
  ])('redacts %s failures as invalid parameter schemas', async (_case, schema) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: schema as AgentTool['parameters'] }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    })
  })

  it('rejects symbol-keyed parameter schemas with the parameters field', async () => {
    const root = await makeTempDir()
    const schema: Record<PropertyKey, unknown> = { type: 'object' }
    Object.defineProperty(schema, Symbol('private'), { value: 'secret', enumerable: true })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: schema as AgentTool['parameters'] }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('preserves valid ordinary JSON parameter arrays', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    const source = await materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: { type: 'object', enum: ['a', 'b'] } }),
      ]]),
    })

    expect((source.tools[0]!.parameters as { enum: string[] }).enum).toEqual(['a', 'b'])
  })

  it('clones JSON parameter arrays without inherited custom map or iterator', async () => {
    const root = await makeTempDir()
    const array = ['a', 'b']
    const prototype = Object.create(Array.prototype) as Record<PropertyKey, unknown>
    prototype.map = () => {
      throw new Error('map must not be called')
    }
    prototype[Symbol.iterator] = () => {
      throw new Error('iterator must not be called')
    }
    Object.setPrototypeOf(array, prototype)
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    const source = await materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: { type: 'object', enum: array } }),
      ]]),
    })

    expect((source.tools[0]!.parameters as { enum: string[] }).enum).toEqual(['a', 'b'])
  })

  it.each([
    ['throwing parameter array', new Proxy(['a'], { get() { throw SECRET_THROW } })],
    ['revoked parameter array', revokedProxy(['a'])],
    ['throwing nested parameter array', [new Proxy({ type: 'string' }, { ownKeys() { throw SECRET_THROW } })]],
    ['revoked nested parameter array', [revokedProxy({ type: 'string' })]],
  ])('redacts %s failures as invalid parameter schemas', async (_case, array) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expectMaterializeRejectsRedacted({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: { type: 'object', anyOf: array } }),
      ]]),
    }, {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    })
  })

  it('rejects accessor indexes in JSON parameter arrays without invoking them', async () => {
    const root = await makeTempDir()
    const array = [] as unknown[]
    array.length = 1
    let getterCalls = 0
    Object.defineProperty(array, 0, {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error('getter must not be invoked')
      },
    })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: { type: 'object', enum: array } }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    } satisfies Partial<AuthoredAgentMaterializationError>)
    expect(getterCalls).toBe(0)
  })

  it('rejects sparse parameter arrays even when numeric values are inherited', async () => {
    const root = await makeTempDir()
    const sparseArray = [] as unknown[]
    sparseArray.length = 1
    const inheritedIndex = Object.create(Array.prototype) as Record<string, unknown>
    inheritedIndex[0] = { type: 'string' }
    Object.setPrototypeOf(sparseArray, inheritedIndex)
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: { type: 'object', anyOf: sparseArray } }),
      ]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('rejects circular parameter schemas with the invalid-tool code and parameters field', async () => {
    const root = await makeTempDir()
    const circularSchema: Record<string, unknown> = { type: 'object', properties: {} }
    circularSchema.self = circularSchema
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    let error: unknown
    try {
      await materializeAgentDirectory({
        directory: root,
        toolCatalog: new Map([[
          'private.catalog.ref',
          makeTool('valid_tool', { parameters: circularSchema }),
        ]]),
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: 'toolRefs[0].parameters',
    } satisfies Partial<AuthoredAgentMaterializationError>)
    expect(error).not.toBeInstanceOf(RangeError)
    expect((error as Error).message).not.toContain('private.catalog.ref')
    expect((error as Error).message).not.toContain('valid_tool')
  })

  it('preserves own __proto__ parameter schema properties without prototype pollution', async () => {
    const root = await makeTempDir()
    const schema: Record<string, unknown> = { type: 'object' }
    Object.defineProperty(schema, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    const source = await materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([[
        'private.catalog.ref',
        makeTool('valid_tool', { parameters: schema }),
      ]]),
    })

    const parameters = source.tools[0]!.parameters as Record<string, unknown>
    expect(Object.getPrototypeOf(parameters)).toBe(null)
    expect(Object.hasOwn(parameters, '__proto__')).toBe(true)
    expect(parameters.__proto__).toEqual({ polluted: true })
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('rejects duplicate resolved authored tool names with a redacted collision error', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.first', 'private.second'] }),
    })

    let error: unknown
    try {
      await materializeAgentDirectory({
        directory: root,
        toolCatalog: new Map([
          ['private.first', makeTool('duplicate_private_tool')],
          ['private.second', makeTool('duplicate_private_tool')],
        ]),
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION,
      field: 'toolRefs[1]',
    } satisfies Partial<AuthoredAgentMaterializationError>)
    expect((error as Error).message).not.toContain('private.first')
    expect((error as Error).message).not.toContain('private.second')
    expect((error as Error).message).not.toContain('duplicate_private_tool')
  })

  it('copies and freezes resolved authored tools, readiness arrays, and schemas', async () => {
    const root = await makeTempDir()
    const schema = { type: 'object', properties: { claimId: { type: 'string' } } }
    const catalogTool = makeTool('compare_quotes', {
      parameters: schema,
      readinessRequirements: ['runtime:python'] as ToolReadinessRequirement[],
    })
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['quotes.compare'] }),
    })

    const source = await materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([['quotes.compare', catalogTool]]),
    })
    const [tool] = source.tools
    const parameters = tool!.parameters as { properties: { claimId: { type: string } } }

    expect(Object.isFrozen(tool)).toBe(true)
    expect(Object.isFrozen(tool!.readinessRequirements)).toBe(true)
    expect(Object.isFrozen(tool!.parameters)).toBe(true)
    expect(Object.isFrozen(parameters.properties)).toBe(true)
    expect(Object.isFrozen(parameters.properties.claimId)).toBe(true)
    expect(() => ((tool as AgentTool).description = 'changed')).toThrow(TypeError)
    expect(() => (tool!.readinessRequirements as ToolReadinessRequirement[]).push('workspace-fs')).toThrow(TypeError)
    expect(() => (parameters.properties.claimId.type = 'number')).toThrow(TypeError)

    catalogTool.description = 'mutated catalog tool'
    schema.properties.claimId.type = 'number'
    expect(tool!.description).toBe('compare_quotes tool')
    expect(parameters.properties.claimId.type).toBe('string')
  })

  it('does not dynamically import authored tool modules while resolving matching refs', async () => {
    const root = await makeTempDir()
    await mkdir(join(root, 'tools'))
    await writeFile(
      join(root, 'tools', 'spy.mjs'),
      'globalThis.__authoredToolImportSpy = (globalThis.__authoredToolImportSpy ?? 0) + 1\n',
      'utf8',
    )
    ;(globalThis as { __authoredToolImportSpy?: number }).__authoredToolImportSpy = 0
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['tools/spy.mjs'] }),
    })

    await materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([['tools/spy.mjs', makeTool('spy_tool')]]),
    })

    expect((globalThis as { __authoredToolImportSpy?: number }).__authoredToolImportSpy).toBe(0)
  })

  it.each([
    'capabilityRequirements',
    'skillRefs',
    'mcpServerRefs',
  ])('rejects unsupported authored reference family %s', async (field) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ [field]: ['declared-ref'] }),
    })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
      field,
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('does not disclose authored ref or catalog values in invalid-tool messages', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    let error: unknown
    try {
      await materializeAgentDirectory({
        directory: root,
        toolCatalog: new Map([['private.catalog.ref', makeTool('private.secret.name')]]),
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AuthoredAgentMaterializationError)
    expect((error as AuthoredAgentMaterializationError).code).toBe(ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID)
    expect((error as Error).message).not.toContain('private.catalog.ref')
    expect((error as Error).message).not.toContain('private.secret.name')
  })

  it('preserves compiler validation error codes instead of wrapping them', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ instructionsRef: './instructions.md' }),
    })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('reads instructions from the compiler-verified UTF-8 asset only', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { instructions: 'Verified UTF-8 🛡️' })

    const source = await materializeAgentDirectory({ directory: root })

    expect(source.instructions).toBe(await readFile(join(root, 'instructions.md'), 'utf8'))
  })
})

describe('authored agent source export boundary', () => {
  it('exports materialization only from the server surface', () => {
    const serverIndex = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8')
    const sharedIndex = readFileSync(new URL('../../../shared/index.ts', import.meta.url), 'utf8')
    const frontIndex = readFileSync(new URL('../../../front/index.ts', import.meta.url), 'utf8')

    expect(serverIndex).toContain('materializeAgentDirectory')
    expect(serverIndex).toContain('AuthoredAgentToolCatalog')
    expect(serverIndex).toContain('MaterializedAgentSourceV1')
    expect(sharedIndex).not.toMatch(/materializeAgentDirectory|MaterializedAgentSourceV1/)
    expect(frontIndex).not.toMatch(/materializeAgentDirectory|MaterializedAgentSourceV1/)
  })
})
