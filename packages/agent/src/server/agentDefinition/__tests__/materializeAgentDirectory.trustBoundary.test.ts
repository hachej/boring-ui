import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool, ToolReadinessRequirement } from '../../../shared/tool'
import {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
} from '../../index'
import {
  definition,
  expectMaterializeRejectsRedacted,
  makeTempDir,
  makeTool,
  revokedProxy,
  SECRET_THROW,
  throwingProxy,
  writeAgentDirectory,
} from './materializeAgentDirectory.testSupport'

describe('materializeAgentDirectory trust boundary and schema hardening', () => {
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

})
