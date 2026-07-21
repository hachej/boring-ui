import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { ERROR_CODES, HttpError } from '../../shared/errors'
import {
  CoreProductRoutingError,
  createCoreProductRouting,
  normalizeProductHostname,
  validateCoreProductWorkspacePolicyCoverage,
  validateSharedAuthCookieDomain,
  type CoreProductRoutingConfig,
} from '../productDeclarations'

function config(overrides: Partial<CoreProductRoutingConfig> = {}): CoreProductRoutingConfig {
  return {
    domains: [
      { hostname: 'legal.products.example', workspaceTypeId: 'contract-review' },
      { hostname: 'research.products.example', workspaceTypeId: 'research' },
    ],
    workspaceProducts: [
      { workspaceTypeId: 'contract-review', label: 'Contract review', allowWorkspaceCreation: true },
      { workspaceTypeId: 'research', label: 'Research', allowWorkspaceCreation: false },
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
    undefined, '', ' example.com', 'example.com ', 'a.example,b.example',
    'a.example, b.example', '%6cegal.example', '*.example.com', '.example.com',
    'example..com', 'example.com..', 'example.com/path', 'user@example.com',
    'example.com:invalid', '127.1', '0x7f000001', '0177.0.0.1', '2130706433',
    '0x7f.0.0.1', '127.0x0.0.1', '127.0.0.0x1', '2001:db8::1', '[2001:db8::1',
  ])('rejects malformed or multi-valued input %j with a stable code', (input) => {
    expect(() => normalizeProductHostname(input)).toThrowError(
      expect.objectContaining({
        name: 'CoreProductRoutingError',
        code: ERROR_CODES.INVALID_PRODUCT_HOSTNAME,
      }),
    )
  })
})

describe('createCoreProductRouting', () => {
  it('defensively copies and freezes a two-product graph', () => {
    const input = config()
    const routing = createCoreProductRouting(input)
    ;(input.domains as Array<{ hostname: string; workspaceTypeId: string }>).push({
      hostname: 'mutated.products.example', workspaceTypeId: 'research',
    })

    expect(routing.domains).toHaveLength(2)
    expect(routing.workspaceProducts).toHaveLength(2)
    expect(Object.isFrozen(routing)).toBe(true)
    expect(Object.isFrozen(routing.domains)).toBe(true)
    expect(Object.isFrozen(routing.domains[0])).toBe(true)
    expect(Object.isFrozen(routing.workspaceProducts)).toBe(true)
    expect(Object.isFrozen(routing.workspaceProducts[0])).toBe(true)
    expect(Object.isFrozen(routing.resolveRequestScope)).toBe(true)
  })

  it('returns the exact frozen CoreProductRequestScope and no extra authority', () => {
    const scope = createCoreProductRouting(config()).resolveRequestScope(
      request('LEGAL.PRODUCTS.EXAMPLE.'),
    )

    expect(scope).toEqual({
      workspaceTypeId: 'contract-review',
      allowWorkspaceCreation: true,
      normalizedHostname: 'legal.products.example',
    })
    expect(Object.keys(scope).sort()).toEqual([
      'allowWorkspaceCreation', 'normalizedHostname', 'workspaceTypeId',
    ])
    expect(Object.isFrozen(scope)).toBe(true)
  })

  it.each(['unknown.products.example', 'child.legal.products.example'])('fails %s closed', (hostname) => {
    const routing = createCoreProductRouting(config())
    expect(() => routing.resolveRequestScope(request(hostname))).toThrowError(
      expect.objectContaining({
        name: 'HttpError', code: ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME, status: 421,
      } satisfies Partial<HttpError>),
    )
  })

  it('rejects duplicate normalized startup hosts', () => {
    expect(() => createCoreProductRouting(config({
      domains: [
        { hostname: 'LEGAL.products.example.', workspaceTypeId: 'contract-review' },
        { hostname: 'legal.products.example:443', workspaceTypeId: 'contract-review' },
      ],
      workspaceProducts: [
        { workspaceTypeId: 'contract-review', label: 'Legal', allowWorkspaceCreation: true },
      ],
    }))).toThrowError(expect.objectContaining({ code: ERROR_CODES.DUPLICATE_PRODUCT_HOSTNAME }))
  })

  it.each([
    {
      name: 'invalid workspace type',
      input: config({ workspaceProducts: [{ workspaceTypeId: 'Invalid', label: 'Invalid', allowWorkspaceCreation: true }] }),
      code: ERROR_CODES.INVALID_WORKSPACE_TYPE_ID,
    },
    {
      name: 'reserved default type',
      input: { domains: [{ hostname: 'default.products.example', workspaceTypeId: 'default' }], workspaceProducts: [{ workspaceTypeId: 'default', label: 'Default', allowWorkspaceCreation: true }] },
      code: ERROR_CODES.INVALID_PRODUCT_DEFAULT,
    },
    {
      name: 'duplicate product',
      input: config({ workspaceProducts: [
        { workspaceTypeId: 'contract-review', label: 'One', allowWorkspaceCreation: true },
        { workspaceTypeId: 'contract-review', label: 'Two', allowWorkspaceCreation: false },
      ] }),
      code: ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG,
    },
    {
      name: 'unknown domain product',
      input: config({ domains: [{ hostname: 'legal.products.example', workspaceTypeId: 'missing' }] }),
      code: ERROR_CODES.PRODUCT_ROUTING_COVERAGE_MISMATCH,
    },
    {
      name: 'product without domain',
      input: config({ domains: [{ hostname: 'legal.products.example', workspaceTypeId: 'contract-review' }] }),
      code: ERROR_CODES.PRODUCT_ROUTING_COVERAGE_MISMATCH,
    },
    {
      name: 'non-boolean creation policy',
      input: config({ workspaceProducts: [{ workspaceTypeId: 'contract-review', label: 'Legal', allowWorkspaceCreation: 'yes' as unknown as boolean }] }),
      code: ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG,
    },
  ])('fails startup for $name with a stable code', ({ input, code }) => {
    expect(() => createCoreProductRouting(input)).toThrowError(
      expect.objectContaining({ name: 'CoreProductRoutingError', code } satisfies Partial<CoreProductRoutingError>),
    )
  })
})

describe('host composition and shared auth', () => {
  it('accepts exact Workspace policy type coverage without agent details', () => {
    expect(() => validateCoreProductWorkspacePolicyCoverage(
      createCoreProductRouting(config()),
      ['research', 'contract-review'],
    )).not.toThrow()
  })

  it.each([
    { ids: ['contract-review'], code: ERROR_CODES.PRODUCT_WORKSPACE_POLICY_MISMATCH },
    { ids: ['contract-review', 'research', 'extra'], code: ERROR_CODES.PRODUCT_WORKSPACE_POLICY_MISMATCH },
    { ids: ['contract-review', 'contract-review'], code: ERROR_CODES.INVALID_WORKSPACE_POLICY_TYPE_IDS },
    { ids: [], code: ERROR_CODES.INVALID_WORKSPACE_POLICY_TYPE_IDS },
  ])('rejects invalid Workspace policy coverage %#', ({ ids, code }) => {
    expect(() => validateCoreProductWorkspacePolicyCoverage(
      createCoreProductRouting(config()), ids,
    )).toThrowError(expect.objectContaining({ code }))
  })

  it('accepts an explicit secure parent cookie scope and all exact origins', () => {
    expect(validateSharedAuthCookieDomain({
      domain: 'products.example',
      routing: createCoreProductRouting(config()),
      authUrl: 'https://legal.products.example',
      sessionCookieSecure: true,
      corsOrigins: ['https://legal.products.example', 'https://research.products.example'],
    })).toBe('products.example')
  })

  it.each([
    { domain: '*.products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN },
    { domain: 'other.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.SHARED_AUTH_COOKIE_SCOPE_MISMATCH },
    { domain: 'products.example', authUrl: 'http://legal.products.example', secure: false, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.INSECURE_SHARED_AUTH_COOKIE },
    { domain: 'products.example', authUrl: 'https://auth.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.SHARED_AUTH_COOKIE_SCOPE_MISMATCH },
    { domain: 'products.example', authUrl: 'https://legal.products.example:8443', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.SHARED_AUTH_COOKIE_SCOPE_MISMATCH },
    { domain: 'products.example', authUrl: 'https://user:pass@legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN },
    { domain: 'products.example', authUrl: 'https://legal.products.example/auth', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN },
    { domain: 'products.example', authUrl: 'https://legal.products.example?next=1', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN },
    { domain: 'products.example', authUrl: 'https://legal.products.example#fragment', secure: true, origins: ['https://legal.products.example', 'https://research.products.example'], code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN },
    { domain: 'products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example'], code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING },
    { domain: 'products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example', 'https://hostile.example'], code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING },
    { domain: 'products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'http://research.products.example'], code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING },
    { domain: 'products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://*.products.example'], code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING },
    { domain: 'products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example/path'], code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING },
    { domain: 'products.example', authUrl: 'https://legal.products.example', secure: true, origins: ['https://legal.products.example', 'https://research.products.example', 'https://research.products.example'], code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING },
    {
      domain: 'example.com', authUrl: 'https://legal.products.example.com', secure: true,
      origins: ['https://legal.products.example.com', 'https://research.products.example.com'],
      routing: config({ domains: [
        { hostname: 'legal.products.example.com', workspaceTypeId: 'contract-review' },
        { hostname: 'research.products.example.com', workspaceTypeId: 'research' },
      ] }),
      code: ERROR_CODES.SHARED_AUTH_COOKIE_SCOPE_MISMATCH,
    },
    {
      domain: 'co.uk', authUrl: 'https://legal.co.uk', secure: true,
      origins: ['https://legal.co.uk', 'https://research.co.uk'],
      routing: config({ domains: [
        { hostname: 'legal.co.uk', workspaceTypeId: 'contract-review' },
        { hostname: 'research.co.uk', workspaceTypeId: 'research' },
      ] }),
      code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN,
    },
  ])('rejects unsafe shared cookie config %#', ({ domain, authUrl, secure, origins, code, routing }) => {
    expect(() => validateSharedAuthCookieDomain({
      domain,
      routing: createCoreProductRouting(routing ?? config()),
      authUrl,
      sessionCookieSecure: secure,
      corsOrigins: origins,
    })).toThrowError(expect.objectContaining({ code }))
  })
})

describe('server-only ownership audit', () => {
  it('exports routing only from server entrypoints and contains no agent behavior authority', () => {
    const serverIndex = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const appServerIndex = readFileSync(new URL('../../app/server/index.ts', import.meta.url), 'utf8')
    const sharedIndex = readFileSync(new URL('../../shared/index.ts', import.meta.url), 'utf8')
    const frontIndex = readFileSync(new URL('../../front/index.ts', import.meta.url), 'utf8')
    const appFrontIndex = readFileSync(new URL('../../app/front/index.ts', import.meta.url), 'utf8')
    const source = readFileSync(new URL('../productDeclarations.ts', import.meta.url), 'utf8')

    expect(serverIndex).toContain("from './productDeclarations.js'")
    expect(appServerIndex).toContain("from '../../server/productDeclarations.js'")
    for (const browserEntry of [sharedIndex, frontIndex, appFrontIndex]) {
      expect(browserEntry).not.toMatch(/productDeclarations|CoreProductRouting/)
    }
    expect(source).not.toMatch(/agentTypeId|behavior|plugin|tool|deployment|authored/i)
  })
})
