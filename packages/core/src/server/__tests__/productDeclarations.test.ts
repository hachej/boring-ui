import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import type { MaterializedAgentSourceV1 } from '@hachej/boring-agent/server'
import { ERROR_CODES, HttpError } from '../../shared/errors'
import {
  AGENT_TYPE_ID_PATTERN,
  StaticProductDeclarationsError,
  createStaticProductDeclarations,
  isAgentTypeId,
  normalizeProductHostname,
  type ServerOnlyAgentBehaviorBinding,
  type StaticProductDeclarationsInput,
} from '../productDeclarations'
import { WORKSPACE_TYPE_ID_PATTERN } from '../../shared/workspaceType'

type TestBehavior = ServerOnlyAgentBehaviorBinding & {
  instructions: string
  tools: Array<{
    name: string
    metadata: { source: string }
    execute: () => string
  }>
}

function declarations(
  overrides: Partial<StaticProductDeclarationsInput<TestBehavior>> = {},
): StaticProductDeclarationsInput<TestBehavior> {
  return {
    domains: [
      { hostname: 'legal.example', workspaceTypeId: 'contract-review' },
    ],
    workspaceTypes: [
      { workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' },
    ],
    agentTypes: [
      {
        agentTypeId: 'legal-reviewer',
        behavior: {
          instructions: 'Review the contract.',
          tools: [{
            name: 'review',
            metadata: { source: 'trusted-catalog' },
            execute: () => 'reviewed',
          }],
        },
      },
    ],
    ...overrides,
  }
}

function request(hostname: string): FastifyRequest {
  return { hostname, id: 'request-1' } as FastifyRequest
}

describe('normalizeProductHostname', () => {
  it.each([
    ['EXAMPLE.COM', 'example.com'],
    ['bÜCHER.example', 'xn--bcher-kva.example'],
    ['example.com.', 'example.com'],
    ['EXAMPLE.com.:443', 'example.com'],
    ['127.0.0.1:3000', '127.0.0.1'],
    ['[2001:0DB8:0:0:0:0:0:1]:8443', '[2001:db8::1]'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeProductHostname(input)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    ' example.com',
    'example.com ',
    'a.example,b.example',
    'a.example, b.example',
    '%6cegal.example',
    '*.example.com',
    '.example.com',
    'example..com',
    'example.com..',
    'example.com/path',
    'user@example.com',
    'example.com:invalid',
    '127.1',
    '0x7f000001',
    '0177.0.0.1',
    '2130706433',
    '0x7f.0.0.1',
    '127.0x0.0.1',
    '127.0.0.0x1',
    '0x7f.1',
    '0177.0x0.1',
    '2001:db8::1',
    '[2001:db8::1',
  ])('rejects malformed or multi-valued input %j with a stable code', (input) => {
    expect(() => normalizeProductHostname(input)).toThrowError(
      expect.objectContaining({
        name: 'StaticProductDeclarationsError',
        code: ERROR_CODES.INVALID_PRODUCT_HOSTNAME,
      }),
    )
  })
})

describe('createStaticProductDeclarations', () => {
  it('reuses the shipped identifier grammar for agent type IDs', () => {
    expect(AGENT_TYPE_ID_PATTERN).toBe(WORKSPACE_TYPE_ID_PATTERN)
    expect(isAgentTypeId('legal-reviewer')).toBe(true)
    expect(isAgentTypeId('LegalReviewer')).toBe(false)
  })

  it('accepts the existing server-only materialized agent behavior shape', () => {
    let executionCount = 0
    const execute = async () => {
      executionCount += 1
      return { content: [{ type: 'text' as const, text: 'reviewed' }] }
    }
    const behavior: MaterializedAgentSourceV1 = {
      schemaVersion: 1,
      agentTypeId: 'legal-reviewer',
      version: '1.0.0',
      instructions: 'Review the contract.',
      tools: [{
        name: 'review',
        description: 'Review one contract.',
        parameters: { type: 'object' },
        execute,
      }],
      declaredToolRefs: ['review'],
    }
    const input: StaticProductDeclarationsInput<MaterializedAgentSourceV1> = {
      domains: [{ hostname: 'legal.example', workspaceTypeId: 'contract-review' }],
      workspaceTypes: [{ workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' }],
      agentTypes: [{ agentTypeId: 'legal-reviewer', behavior }],
    }

    const graph = createStaticProductDeclarations(input)

    expect(graph.agentTypes[0]!.behavior).toMatchObject({
      agentTypeId: 'legal-reviewer',
      instructions: 'Review the contract.',
      tools: [{ name: 'review' }],
    })
    expect(Object.isFrozen(behavior.tools[0]!.execute)).toBe(true)
    expect(executionCount).toBe(0)
  })

  it('defensively snapshots and deeply freezes the declaration graph', () => {
    const input = declarations()
    const graph = createStaticProductDeclarations(input)
    const originalBehavior = input.agentTypes[0]!.behavior
    const originalExecute = originalBehavior.tools[0]!.execute

    originalBehavior.instructions = 'Mutated instructions.'
    originalBehavior.tools[0]!.name = 'mutated-tool'
    originalBehavior.tools[0]!.metadata.source = 'mutated-source'
    ;(input.domains as Array<{ hostname: string; workspaceTypeId: string }>).push({
      hostname: 'mutated.example',
      workspaceTypeId: 'contract-review',
    })

    expect(graph.domains).toEqual([
      { hostname: 'legal.example', workspaceTypeId: 'contract-review' },
    ])
    expect(graph.agentTypes[0]!.behavior).toMatchObject({
      instructions: 'Review the contract.',
      tools: [{ name: 'review', metadata: { source: 'trusted-catalog' } }],
    })
    const frozenBehavior = graph.agentTypes[0]!.behavior as unknown as TestBehavior
    expect(Object.isFrozen(graph)).toBe(true)
    expect(Object.isFrozen(graph.domains)).toBe(true)
    expect(Object.isFrozen(graph.workspaceTypes)).toBe(true)
    expect(Object.isFrozen(graph.agentTypes)).toBe(true)
    expect(Object.isFrozen(graph.agentTypes[0]!.behavior)).toBe(true)
    expect(Object.isFrozen(frozenBehavior.tools)).toBe(true)
    expect(Object.isFrozen(frozenBehavior.tools[0])).toBe(true)
    expect(Object.isFrozen(frozenBehavior.tools[0]!.metadata)).toBe(true)
    expect(frozenBehavior.tools[0]!.execute).toBe(originalExecute)
    expect(Object.isFrozen(originalExecute)).toBe(true)
    expect(Object.isFrozen(graph.resolveDomain)).toBe(true)
  })

  it('resolves only the exact normalized domain and workspace type before auth', () => {
    const graph = createStaticProductDeclarations(declarations())

    const resolved = graph.resolveDomain(request('LEGAL.EXAMPLE.'))

    expect(resolved).toEqual({
      hostname: 'legal.example',
      workspaceTypeId: 'contract-review',
    })
    expect(resolved).not.toHaveProperty('agentTypeId')
    expect(resolved).not.toHaveProperty('behavior')
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('never falls back to a default declaration for an unknown or suffix host', () => {
    const graph = createStaticProductDeclarations({
      domains: [{ hostname: 'legal.example', workspaceTypeId: 'contract-review' }],
      workspaceTypes: [{ workspaceTypeId: 'contract-review', agentTypeId: 'primary' }],
      agentTypes: [{ agentTypeId: 'primary', behavior: {} }],
    })

    for (const hostname of ['unknown.example', 'child.default.example']) {
      expect(() => graph.resolveDomain(request(hostname))).toThrowError(
        expect.objectContaining({
          name: 'HttpError',
          code: ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME,
          status: 421,
        } satisfies Partial<HttpError>),
      )
    }
  })

  it('rejects duplicate normalized startup hosts', () => {
    expect(() => createStaticProductDeclarations(declarations({
      domains: [
        { hostname: 'LEGAL.example.', workspaceTypeId: 'contract-review' },
        { hostname: 'legal.example:443', workspaceTypeId: 'contract-review' },
      ],
    }))).toThrowError(expect.objectContaining({
      code: ERROR_CODES.DUPLICATE_PRODUCT_HOSTNAME,
    }))
  })

  it.each([
    {
      name: 'invalid workspace type ID',
      input: declarations({
        workspaceTypes: [{ workspaceTypeId: 'ContractReview', agentTypeId: 'legal-reviewer' }],
      }),
      code: ERROR_CODES.INVALID_WORKSPACE_TYPE_ID,
    },
    {
      name: 'invalid agent type ID',
      input: declarations({
        workspaceTypes: [{ workspaceTypeId: 'contract-review', agentTypeId: 'LegalReviewer' }],
      }),
      code: ERROR_CODES.INVALID_AGENT_TYPE_ID,
    },
    {
      name: 'duplicate workspace type declaration',
      input: declarations({
        workspaceTypes: [
          { workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' },
          { workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' },
        ],
      }),
      code: ERROR_CODES.INVALID_PRODUCT_DECLARATIONS,
    },
    {
      name: 'duplicate agent binding',
      input: declarations({
        agentTypes: [
          { agentTypeId: 'legal-reviewer', behavior: { instructions: 'One', tools: [] } },
          { agentTypeId: 'legal-reviewer', behavior: { instructions: 'Two', tools: [] } },
        ],
      }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
    {
      name: 'domain with a missing workspace type',
      input: declarations({
        domains: [{ hostname: 'legal.example', workspaceTypeId: 'missing-type' }],
      }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
    {
      name: 'workspace type with a missing agent binding',
      input: declarations({ agentTypes: [] }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
    {
      name: 'invalid default binding',
      input: {
        domains: [{ hostname: 'default.example', workspaceTypeId: 'default' }],
        workspaceTypes: [{ workspaceTypeId: 'default', agentTypeId: 'primary' }],
        agentTypes: [{ agentTypeId: 'secondary', behavior: {} }],
      },
      code: ERROR_CODES.INVALID_PRODUCT_DEFAULT,
    },
    {
      name: 'unbound workspace type',
      input: declarations({
        workspaceTypes: [
          { workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' },
          { workspaceTypeId: 'unbound-type', agentTypeId: 'legal-reviewer' },
        ],
      }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
    {
      name: 'dangling agent binding',
      input: declarations({
        agentTypes: [
          { agentTypeId: 'legal-reviewer', behavior: { instructions: 'One', tools: [] } },
          { agentTypeId: 'unbound-agent', behavior: { instructions: 'Two', tools: [] } },
        ],
      }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
    {
      name: 'stateful callable behavior binding',
      input: declarations({
        agentTypes: [{
          agentTypeId: 'legal-reviewer',
          behavior: {
            instructions: 'Unsafe behavior.',
            execute: Object.assign(() => 'unsafe', { state: { mutable: true } }),
          } as unknown as TestBehavior,
        }],
      }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
    {
      name: 'non-plain behavior binding',
      input: declarations({
        agentTypes: [{
          agentTypeId: 'legal-reviewer',
          behavior: new Date() as unknown as TestBehavior,
        }],
      }),
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    },
  ])('fails startup for $name with a stable code', ({ input, code }) => {
    expect(() => createStaticProductDeclarations(input)).toThrowError(
      expect.objectContaining({
        name: 'StaticProductDeclarationsError',
        code,
      } satisfies Partial<StaticProductDeclarationsError>),
    )
  })

  it('rejects cyclic behavior bindings with a stable code', () => {
    const behavior: Record<string, unknown> = {}
    behavior.self = behavior

    expect(() => createStaticProductDeclarations(declarations({
      agentTypes: [{ agentTypeId: 'legal-reviewer', behavior: behavior as TestBehavior }],
    }))).toThrowError(expect.objectContaining({
      code: ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
    }))
  })
})

describe('server-only and legacy-authority audits', () => {
  it('exports product declarations only from server entrypoints', () => {
    const serverIndex = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const appServerIndex = readFileSync(new URL('../../app/server/index.ts', import.meta.url), 'utf8')
    const sharedIndex = readFileSync(new URL('../../shared/index.ts', import.meta.url), 'utf8')
    const frontIndex = readFileSync(new URL('../../front/index.ts', import.meta.url), 'utf8')
    const appFrontIndex = readFileSync(new URL('../../app/front/index.ts', import.meta.url), 'utf8')

    expect(serverIndex).toContain("from './productDeclarations.js'")
    expect(appServerIndex).toContain("from '../../server/productDeclarations.js'")
    for (const browserEntry of [sharedIndex, frontIndex, appFrontIndex]) {
      expect(browserEntry).not.toMatch(/productDeclarations|StaticProductDeclarations/)
    }
  })

  it('contains no compiler or deployment resolver authority', () => {
    const source = readFileSync(new URL('../productDeclarations.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(
      /compileAgentDirectory|resolveAgentDeployment|defaultDeploymentId|activeRevision|resolvedDigest|definitionRef|deploymentRef|requestScope headers/i,
    )
  })
})
