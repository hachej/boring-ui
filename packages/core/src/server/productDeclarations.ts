import type { FastifyRequest } from 'fastify'
import {
  ERROR_CODES,
  HttpError,
  type ErrorCode,
} from '../shared/errors.js'
import {
  WORKSPACE_TYPE_ID_PATTERN,
  isWorkspaceTypeId,
} from '../shared/workspaceType.js'
import type { CoreRequestScopeResolver } from './app/types.js'

export const AGENT_TYPE_ID_PATTERN = WORKSPACE_TYPE_ID_PATTERN

export function isAgentTypeId(value: unknown): value is string {
  return isWorkspaceTypeId(value)
}

/**
 * Trusted callable capability. The host must compose it without capturing a
 * concrete request, user, Workspace, Sandbox, root, or runtime handle.
 */
export type ServerOnlyAgentBehaviorCallable = (...args: never[]) => unknown

export type ServerOnlyAgentBehaviorValue =
  | null
  | string
  | number
  | boolean
  | ServerOnlyAgentBehaviorCallable
  | readonly ServerOnlyAgentBehaviorValue[]
  | { readonly [key: string]: ServerOnlyAgentBehaviorValue }

export type ServerOnlyAgentBehaviorBinding = Readonly<{
  [key: string]: ServerOnlyAgentBehaviorValue
}>

export interface StaticProductDeclarationsInput<
  TBehavior extends object = ServerOnlyAgentBehaviorBinding,
> {
  readonly domains: readonly {
    readonly hostname: string
    readonly workspaceTypeId: string
  }[]
  readonly workspaceTypes: readonly {
    readonly workspaceTypeId: string
    readonly agentTypeId: string
  }[]
  readonly agentTypes: readonly {
    readonly agentTypeId: string
    readonly behavior: TBehavior
  }[]
}

export interface StaticProductDomainDeclaration {
  readonly hostname: string
  readonly workspaceTypeId: string
}

export interface StaticProductWorkspaceTypeDeclaration {
  readonly workspaceTypeId: string
  readonly agentTypeId: string
}

export interface StaticProductAgentTypeDeclaration {
  readonly agentTypeId: string
  readonly behavior: ServerOnlyAgentBehaviorBinding
}

export interface ResolvedStaticProductDomain {
  readonly hostname: string
  readonly workspaceTypeId: string
}

export interface StaticProductDeclarations {
  readonly domains: readonly StaticProductDomainDeclaration[]
  readonly workspaceTypes: readonly StaticProductWorkspaceTypeDeclaration[]
  readonly agentTypes: readonly StaticProductAgentTypeDeclaration[]
  resolveDomain(request: FastifyRequest): ResolvedStaticProductDomain
}

export class StaticProductDeclarationsError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'StaticProductDeclarationsError'
    this.code = code
  }
}

function fail(code: ErrorCode, message: string): never {
  throw new StaticProductDeclarationsError(code, message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function snapshotBinding(
  behavior: object,
  active = new WeakSet<object>(),
): ServerOnlyAgentBehaviorBinding {
  if (!isPlainObject(behavior)) {
    fail(
      ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
      'Product behavior bindings must use plain-object containers',
    )
  }
  if (active.has(behavior)) {
    fail(
      ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID,
      'Product behavior bindings must not contain cycles',
    )
  }

  active.add(behavior)
  const snapshot = Object.fromEntries(
    Object.entries(behavior).map(([key, value]) => [
      key,
      snapshotBindingValue(value, active),
    ]),
  )
  active.delete(behavior)
  return Object.freeze(snapshot) as ServerOnlyAgentBehaviorBinding
}

function snapshotBindingValue(value: unknown, active: WeakSet<object>): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value === 'function') {
    // Executable tool capabilities cannot be meaningfully cloned. They are
    // trusted host-owned leaves, frozen by reference; every surrounding
    // declaration container is still defensively copied and frozen.
    if (Object.keys(value).length > 0) {
      invalidBinding('Callable behavior capabilities must not have enumerable state')
    }
    return Object.freeze(value) as ServerOnlyAgentBehaviorCallable
  }
  if (Array.isArray(value)) {
    if (active.has(value)) {
      invalidBinding('Product behavior bindings must not contain cycles')
    }
    active.add(value)
    const snapshot = value.map((item) => snapshotBindingValue(item, active))
    active.delete(value)
    return Object.freeze(snapshot)
  }
  if (isPlainObject(value)) {
    return snapshotBinding(value as ServerOnlyAgentBehaviorBinding, active)
  }
  invalidBinding(
    'Product behavior bindings support only primitives, arrays, plain objects, and trusted callables',
  )
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
 * Normalize one authority value. Callers resolving a request must pass only
 * Fastify's derived request.hostname, never a forwarding header directly.
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
      ERROR_CODES.INVALID_PRODUCT_DECLARATIONS,
      `${field} must be a non-empty array`,
    )
  }
}

function assertDeclaration(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(ERROR_CODES.INVALID_PRODUCT_DECLARATIONS, `${field} must be an object`)
  }
}

function invalidBinding(message: string): never {
  fail(ERROR_CODES.PRODUCT_DECLARATION_BINDING_INVALID, message)
}

export function assertTypedDomainModeCompatible(options: {
  readonly staticProductDeclarations?: StaticProductDeclarationsInput
  readonly requestScopeResolver?: CoreRequestScopeResolver
}): void {
  if (
    options.staticProductDeclarations !== undefined
    && options.requestScopeResolver !== undefined
  ) {
    fail(
      ERROR_CODES.TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT,
      'Typed-domain declarations cannot be combined with requestScopeResolver',
    )
  }
}

export function createStaticProductDeclarations<TBehavior extends object>(
  input: StaticProductDeclarationsInput<TBehavior>,
): StaticProductDeclarations {
  if (!isPlainObject(input)) {
    fail(ERROR_CODES.INVALID_PRODUCT_DECLARATIONS, 'Product declarations must be an object')
  }
  assertArray(input.domains, 'domains')
  assertArray(input.workspaceTypes, 'workspaceTypes')
  if (!Array.isArray(input.agentTypes)) {
    fail(ERROR_CODES.INVALID_PRODUCT_DECLARATIONS, 'agentTypes must be an array')
  }
  if (input.agentTypes.length === 0) {
    invalidBinding('Every workspace type must have an agent behavior binding')
  }

  const workspaceTypesById = new Map<string, StaticProductWorkspaceTypeDeclaration>()
  for (const [index, raw] of input.workspaceTypes.entries()) {
    assertDeclaration(raw, `workspaceTypes.${index}`)
    const { workspaceTypeId, agentTypeId } = raw
    if (!isWorkspaceTypeId(workspaceTypeId)) {
      fail(ERROR_CODES.INVALID_WORKSPACE_TYPE_ID, 'Invalid workspace type ID')
    }
    if (workspaceTypeId === 'default') {
      fail(
        ERROR_CODES.INVALID_PRODUCT_DEFAULT,
        'The default workspace type is reserved for disabled compatibility mode',
      )
    }
    if (!isAgentTypeId(agentTypeId)) {
      fail(ERROR_CODES.INVALID_AGENT_TYPE_ID, 'Invalid agent type ID')
    }
    if (workspaceTypesById.has(workspaceTypeId)) {
      fail(
        ERROR_CODES.INVALID_PRODUCT_DECLARATIONS,
        `Duplicate workspace type ID: ${workspaceTypeId}`,
      )
    }
    workspaceTypesById.set(
      workspaceTypeId,
      Object.freeze({ workspaceTypeId, agentTypeId }),
    )
  }

  const agentTypesById = new Map<string, StaticProductAgentTypeDeclaration>()
  for (const [index, raw] of input.agentTypes.entries()) {
    assertDeclaration(raw, `agentTypes.${index}`)
    const { agentTypeId, behavior } = raw
    if (!isAgentTypeId(agentTypeId)) {
      fail(ERROR_CODES.INVALID_AGENT_TYPE_ID, 'Invalid agent type ID')
    }
    if (agentTypesById.has(agentTypeId)) {
      invalidBinding(`Duplicate agent behavior binding: ${agentTypeId}`)
    }
    if (!isPlainObject(behavior)) {
      invalidBinding(`agentTypes.${index}.behavior must be an object`)
    }
    agentTypesById.set(
      agentTypeId,
      Object.freeze({
        agentTypeId,
        behavior: snapshotBinding(behavior),
      }),
    )
  }

  const domainsByHostname = new Map<string, StaticProductDomainDeclaration>()
  const referencedWorkspaceTypeIds = new Set<string>()
  for (const [index, raw] of input.domains.entries()) {
    assertDeclaration(raw, `domains.${index}`)
    const { workspaceTypeId } = raw
    if (!isWorkspaceTypeId(workspaceTypeId)) {
      fail(ERROR_CODES.INVALID_WORKSPACE_TYPE_ID, 'Invalid workspace type ID')
    }
    if (workspaceTypeId === 'default') {
      fail(
        ERROR_CODES.INVALID_PRODUCT_DEFAULT,
        'The default workspace type is reserved for disabled compatibility mode',
      )
    }
    const hostname = normalizeProductHostname(raw.hostname)
    if (domainsByHostname.has(hostname)) {
      fail(
        ERROR_CODES.DUPLICATE_PRODUCT_HOSTNAME,
        `Duplicate normalized product hostname: ${hostname}`,
      )
    }
    if (!workspaceTypesById.has(workspaceTypeId)) {
      invalidBinding(`Domain ${hostname} references an unknown workspace type`)
    }
    referencedWorkspaceTypeIds.add(workspaceTypeId)
    domainsByHostname.set(hostname, Object.freeze({ hostname, workspaceTypeId }))
  }

  const referencedAgentTypeIds = new Set<string>()
  for (const workspaceType of workspaceTypesById.values()) {
    if (!referencedWorkspaceTypeIds.has(workspaceType.workspaceTypeId)) {
      invalidBinding(`Workspace type ${workspaceType.workspaceTypeId} has no domain`)
    }
    if (!agentTypesById.has(workspaceType.agentTypeId)) {
      invalidBinding(
        `Workspace type ${workspaceType.workspaceTypeId} references an unknown agent type`,
      )
    }
    referencedAgentTypeIds.add(workspaceType.agentTypeId)
  }
  for (const agentTypeId of agentTypesById.keys()) {
    if (!referencedAgentTypeIds.has(agentTypeId)) {
      invalidBinding(`Agent type ${agentTypeId} has no workspace type`)
    }
  }

  const domains = Object.freeze([...domainsByHostname.values()])
  const workspaceTypes = Object.freeze([...workspaceTypesById.values()])
  const agentTypes = Object.freeze([...agentTypesById.values()])

  const resolveDomain = (request: FastifyRequest): ResolvedStaticProductDomain => {
    let hostname: string
    try {
      hostname = normalizeProductHostname(request.hostname)
    } catch (error) {
      if (error instanceof StaticProductDeclarationsError) {
        throw new HttpError({
          status: 421,
          code: error.code,
          message: 'Invalid request hostname',
          requestId: request.id,
        })
      }
      throw error
    }

    const domain = domainsByHostname.get(hostname)
    if (!domain) {
      throw new HttpError({
        status: 421,
        code: ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME,
        message: 'Unknown product hostname',
        requestId: request.id,
      })
    }
    return domain
  }

  return Object.freeze({
    domains,
    workspaceTypes,
    agentTypes,
    resolveDomain: Object.freeze(resolveDomain),
  })
}
