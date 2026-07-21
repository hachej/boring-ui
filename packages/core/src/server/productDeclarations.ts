import type { FastifyRequest } from 'fastify'
import { getDomain } from 'tldts'
import {
  ERROR_CODES,
  HttpError,
  type ErrorCode,
} from '../shared/errors.js'
import {
  isWorkspaceTypeId,
} from '../shared/workspaceType.js'
import type { CoreRequestScopeResolver } from './app/types.js'

export interface CoreProductRoutingConfig {
  readonly domains: readonly {
    readonly hostname: string
    readonly workspaceTypeId: string
  }[]
  readonly workspaceProducts: readonly {
    readonly workspaceTypeId: string
    readonly label: string
    readonly allowWorkspaceCreation: boolean
  }[]
}

export interface CoreProductDomain {
  readonly hostname: string
  readonly workspaceTypeId: string
}

export interface CoreWorkspaceProduct {
  readonly workspaceTypeId: string
  readonly label: string
  readonly allowWorkspaceCreation: boolean
}

/** Host-derived routing facts only. Membership and Workspace selection happen later. */
export interface CoreProductRequestScope {
  readonly workspaceTypeId: string
  readonly allowWorkspaceCreation: boolean
  readonly normalizedHostname: string
}

export interface CoreProductRouting {
  readonly domains: readonly CoreProductDomain[]
  readonly workspaceProducts: readonly CoreWorkspaceProduct[]
  resolveRequestScope(request: FastifyRequest): CoreProductRequestScope
}

export class CoreProductRoutingError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'CoreProductRoutingError'
    this.code = code
  }
}

function fail(code: ErrorCode, message: string): never {
  throw new CoreProductRoutingError(code, message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertDnsHostname(hostname: string): void {
  if (hostname.length > 253) {
    fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Product hostname is too long')
  }
  const labels = hostname.split('.')
  for (const label of labels) {
    if (
      label.length === 0
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ) {
      fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Product hostname is malformed')
    }
  }
}

/**
 * Normalize one authority value. Request callers must pass Fastify's derived
 * request.hostname, never a forwarding header directly.
 */
export function normalizeProductHostname(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || /[\s%,/@?#\\*]/.test(value)
  ) {
    fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Product hostname is malformed')
  }

  const rawHostname = value.startsWith('[')
    ? undefined
    : (value.lastIndexOf(':') === -1
        ? value
        : value.slice(0, value.lastIndexOf(':'))
      ).replace(/\.$/, '')

  let parsed: URL
  try {
    parsed = new URL(`http://${value}`)
  } catch {
    fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Product hostname is malformed')
  }

  let hostname = parsed.hostname.toLowerCase()
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1)
  if (hostname.length === 0 || hostname.endsWith('.')) {
    fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Product hostname is malformed')
  }

  if (hostname.startsWith('[')) {
    if (!hostname.endsWith(']')) {
      fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Product hostname is malformed')
    }
    return hostname
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && rawHostname !== hostname) {
    fail(
      ERROR_CODES.INVALID_PRODUCT_HOSTNAME,
      'IPv4 product hostnames must use canonical dotted-decimal notation',
    )
  }

  assertDnsHostname(hostname)
  return hostname
}

function assertArray(value: unknown, field: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG,
      `${field} must be a non-empty array`,
    )
  }
}

function assertDeclaration(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG, `${field} must be an object`)
  }
}

function assertWorkspaceTypeId(value: unknown): asserts value is string {
  if (!isWorkspaceTypeId(value)) {
    fail(ERROR_CODES.INVALID_WORKSPACE_TYPE_ID, 'Invalid workspace type ID')
  }
  if (value === 'default') {
    fail(
      ERROR_CODES.INVALID_PRODUCT_DEFAULT,
      'The default workspace type is reserved for disabled compatibility mode',
    )
  }
}

export function assertTypedDomainModeCompatible(options: {
  readonly coreProductRouting?: CoreProductRoutingConfig
  readonly requestScopeResolver?: CoreRequestScopeResolver
}): void {
  if (
    options.coreProductRouting !== undefined
    && options.requestScopeResolver !== undefined
  ) {
    fail(
      ERROR_CODES.TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT,
      'Typed-domain routing cannot be combined with requestScopeResolver',
    )
  }
}

export function createCoreProductRouting(input: CoreProductRoutingConfig): CoreProductRouting {
  if (!isPlainObject(input)) {
    fail(ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG, 'Product routing config must be an object')
  }
  assertArray(input.domains, 'domains')
  assertArray(input.workspaceProducts, 'workspaceProducts')

  const workspaceProductsById = new Map<string, CoreWorkspaceProduct>()
  for (const [index, raw] of input.workspaceProducts.entries()) {
    assertDeclaration(raw, `workspaceProducts.${index}`)
    const { workspaceTypeId, label, allowWorkspaceCreation } = raw
    assertWorkspaceTypeId(workspaceTypeId)
    if (typeof label !== 'string' || label.trim() !== label || label.length === 0 || label.length > 100) {
      fail(ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG, 'Product label must be 1-100 trimmed characters')
    }
    if (typeof allowWorkspaceCreation !== 'boolean') {
      fail(ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG, 'allowWorkspaceCreation must be a boolean')
    }
    if (workspaceProductsById.has(workspaceTypeId)) {
      fail(
        ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG,
        `Duplicate workspace product ID: ${workspaceTypeId}`,
      )
    }
    workspaceProductsById.set(workspaceTypeId, Object.freeze({
      workspaceTypeId,
      label,
      allowWorkspaceCreation,
    }))
  }

  const domainsByHostname = new Map<string, CoreProductDomain>()
  const referencedWorkspaceTypeIds = new Set<string>()
  for (const [index, raw] of input.domains.entries()) {
    assertDeclaration(raw, `domains.${index}`)
    const { workspaceTypeId } = raw
    assertWorkspaceTypeId(workspaceTypeId)
    const hostname = normalizeProductHostname(raw.hostname)
    if (hostname.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      fail(ERROR_CODES.INVALID_PRODUCT_HOSTNAME, 'Typed product domains must be DNS hostnames')
    }
    if (domainsByHostname.has(hostname)) {
      fail(
        ERROR_CODES.DUPLICATE_PRODUCT_HOSTNAME,
        `Duplicate normalized product hostname: ${hostname}`,
      )
    }
    if (!workspaceProductsById.has(workspaceTypeId)) {
      fail(ERROR_CODES.PRODUCT_ROUTING_COVERAGE_MISMATCH, `Domain ${hostname} references an unknown workspace product`)
    }
    referencedWorkspaceTypeIds.add(workspaceTypeId)
    domainsByHostname.set(hostname, Object.freeze({ hostname, workspaceTypeId }))
  }

  for (const workspaceTypeId of workspaceProductsById.keys()) {
    if (!referencedWorkspaceTypeIds.has(workspaceTypeId)) {
      fail(ERROR_CODES.PRODUCT_ROUTING_COVERAGE_MISMATCH, `Workspace product ${workspaceTypeId} has no domain`)
    }
  }

  const domains = Object.freeze([...domainsByHostname.values()])
  const workspaceProducts = Object.freeze([...workspaceProductsById.values()])

  const resolveRequestScope = (request: FastifyRequest): CoreProductRequestScope => {
    let normalizedHostname: string
    try {
      normalizedHostname = normalizeProductHostname(request.hostname)
    } catch (error) {
      if (error instanceof CoreProductRoutingError) {
        throw new HttpError({
          status: 421,
          code: error.code,
          message: 'Invalid request hostname',
          requestId: request.id,
        })
      }
      throw error
    }

    const domain = domainsByHostname.get(normalizedHostname)
    if (!domain) {
      throw new HttpError({
        status: 421,
        code: ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME,
        message: 'Unknown product hostname',
        requestId: request.id,
      })
    }
    const product = workspaceProductsById.get(domain.workspaceTypeId)!
    return Object.freeze({
      workspaceTypeId: product.workspaceTypeId,
      allowWorkspaceCreation: product.allowWorkspaceCreation,
      normalizedHostname,
    })
  }

  return Object.freeze({
    domains,
    workspaceProducts,
    resolveRequestScope: Object.freeze(resolveRequestScope),
  })
}

/**
 * Host-composition boundary: Core sees only Workspace policy type IDs.
 * The two configured type sets must match.
 */
export function validateCoreProductWorkspacePolicyCoverage(
  routing: CoreProductRouting,
  workspacePolicyWorkspaceTypeIds: readonly string[],
): void {
  if (!Array.isArray(workspacePolicyWorkspaceTypeIds) || workspacePolicyWorkspaceTypeIds.length === 0) {
    fail(ERROR_CODES.INVALID_WORKSPACE_POLICY_TYPE_IDS, 'Workspace policy type IDs must be a non-empty array')
  }
  const policyIds = new Set<string>()
  for (const value of workspacePolicyWorkspaceTypeIds) {
    assertWorkspaceTypeId(value)
    if (policyIds.has(value)) {
      fail(ERROR_CODES.INVALID_WORKSPACE_POLICY_TYPE_IDS, `Duplicate Workspace policy type ID: ${value}`)
    }
    policyIds.add(value)
  }
  const productIds = new Set(routing.workspaceProducts.map(({ workspaceTypeId }) => workspaceTypeId))
  if (
    productIds.size !== policyIds.size
    || [...productIds].some((workspaceTypeId) => !policyIds.has(workspaceTypeId))
  ) {
    fail(
      ERROR_CODES.PRODUCT_WORKSPACE_POLICY_MISMATCH,
      'Core product types and Workspace policy type IDs must match exactly',
    )
  }
}

function longestCommonDnsSuffix(hostnames: readonly string[]): string {
  const labels = hostnames.map((hostname) => hostname.split('.').reverse())
  const common: string[] = []
  const shortest = Math.min(...labels.map((parts) => parts.length))
  for (let index = 0; index < shortest; index += 1) {
    const label = labels[0]?.[index]
    if (!label || labels.some((parts) => parts[index] !== label)) break
    common.push(label)
  }
  return common.reverse().join('.')
}

function normalizeHttpsOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    fail(ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING, 'Product auth origins must be absolute HTTPS origins')
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || value !== url.origin
  ) {
    fail(ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING, 'Product auth origins must be exact HTTPS origins')
  }
  return url.origin
}

export function validateSharedAuthCookieDomain(options: {
  readonly domain: unknown
  readonly routing: CoreProductRouting
  readonly authUrl: string
  readonly sessionCookieSecure: boolean
  readonly corsOrigins: readonly string[]
}): string {
  if (typeof options.domain !== 'string') {
    fail(ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN, 'Shared auth cookie domain is required')
  }
  let domain: string
  try {
    domain = normalizeProductHostname(options.domain)
  } catch {
    fail(ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN, 'Shared auth cookie domain is malformed')
  }
  if (
    domain.startsWith('[')
    || /^\d+\.\d+\.\d+\.\d+$/.test(domain)
    || getDomain(domain, { allowPrivateDomains: true }) === null
  ) {
    fail(ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN, 'Shared auth cookie domain must be a registrable DNS parent domain')
  }

  let authUrl: URL
  try {
    authUrl = new URL(options.authUrl)
  } catch {
    fail(ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN, 'Auth URL is malformed')
  }
  if (authUrl.protocol !== 'https:' || !options.sessionCookieSecure) {
    fail(ERROR_CODES.INSECURE_SHARED_AUTH_COOKIE, 'Shared auth cookies require HTTPS and secure cookies')
  }
  let authOrigin: string
  try {
    authOrigin = normalizeHttpsOrigin(options.authUrl)
  } catch {
    fail(ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN, 'Auth URL must be an exact HTTPS product origin')
  }
  const authHostname = normalizeProductHostname(authUrl.hostname)

  const productHostnames = options.routing.domains.map(({ hostname }) => hostname)
  const expectedOrigins = new Set(productHostnames.map((hostname) => `https://${hostname}`))
  if (!productHostnames.includes(authHostname) || !expectedOrigins.has(authOrigin)) {
    fail(ERROR_CODES.SHARED_AUTH_COOKIE_SCOPE_MISMATCH, 'Auth URL must use one declared product origin')
  }
  const narrowestDomain = longestCommonDnsSuffix([authHostname, ...productHostnames])
  if (domain !== narrowestDomain) {
    fail(ERROR_CODES.SHARED_AUTH_COOKIE_SCOPE_MISMATCH, 'Shared auth cookie domain must be the narrowest common product parent')
  }

  const configuredOrigins = new Set(options.corsOrigins.map(normalizeHttpsOrigin))
  if (
    configuredOrigins.size !== options.corsOrigins.length
    || configuredOrigins.size !== expectedOrigins.size
    || [...expectedOrigins].some((origin) => !configuredOrigins.has(origin))
  ) {
    fail(ERROR_CODES.PRODUCT_AUTH_ORIGIN_MISSING, 'Trusted auth origins must exactly match declared product origins')
  }
  return domain
}
