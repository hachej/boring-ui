import { AGENT_TYPE_ID_PATTERN } from './defaultAgentType.js'
import { ERROR_CODES } from '../shared/errors.js'

/**
 * Decision 28 hook: an exact trusted signup-domain mapping may initialize
 * `defaultAgentTypeId` for a newly created default Workspace. The domain has
 * no continuing routing, membership, selection, or authorization effect and
 * never rewrites an existing Workspace.
 *
 * The mapping is trusted host configuration (env/server option) compiled and
 * validated at boot. It is never sourced from a request body, query string, or
 * arbitrary header value; the only request-derived input is the exact
 * normalized request hostname, which is discarded after initialization and is
 * never persisted as product identity.
 */
export type SignupAgentDefaults = Readonly<Record<string, string>>
declare const validatedSignupAgentDefaults: unique symbol
export type ValidatedSignupAgentDefaults = SignupAgentDefaults & {
  readonly [validatedSignupAgentDefaults]: true
}

/** Exact lowercase DNS hostname: labels of [a-z0-9-], no scheme/port/path. */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/

export class SignupAgentDefaultsConfigError extends Error {
  readonly code = ERROR_CODES.INVALID_SIGNUP_AGENT_DEFAULTS
  constructor(message: string) {
    super(message)
    this.name = 'SignupAgentDefaultsConfigError'
  }
}

/**
 * Private handoff from Core's Fastify edge to Better Auth. The edge always
 * overwrites any caller-supplied value with Fastify's trust-proxy-aware
 * hostname before Better Auth can run the post-signup hook.
 */
export const TRUSTED_SIGNUP_HOSTNAME_HEADER = 'x-boring-internal-signup-hostname'

/**
 * Normalizes a request hostname for exact-map lookup: lowercase, trailing dot
 * stripped, `:port` stripped. Returns `null` for absent/malformed hosts (a
 * malformed host simply produces no signup mapping; it is never an auth
 * signal).
 */
export function normalizeSignupHostname(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let host = raw.trim().toLowerCase()
  if (!host) return null
  // Only a DNS authority with an optional numeric port is accepted. In
  // particular, reject schemes, paths, IPv6 literals, and joined proxy values.
  if (host.includes(',') || host.startsWith('[')) return null
  const colon = host.indexOf(':')
  if (colon !== -1) {
    if (colon !== host.lastIndexOf(':')) return null
    const port = host.slice(colon + 1)
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65_535) return null
    host = host.slice(0, colon)
  }
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (!host || host.length > 253) return null
  return HOSTNAME_PATTERN.test(host) ? host : null
}

/**
 * Validates the static trusted mapping shape at boot. Fail-fast: malformed
 * hostnames, non-exact keys, or malformed agent ids reject boot with a stable
 * error instead of silently dropping entries.
 */
export function parseSignupAgentDefaults(value: unknown): SignupAgentDefaults {
  if (value === undefined || value === null) return Object.freeze({})
  if (
    typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new SignupAgentDefaultsConfigError(
      'signupAgentDefaults must be an object mapping exact hostname -> agentTypeId',
    )
  }
  const out: Record<string, string> = {}
  for (const [rawHost, agentTypeId] of Object.entries(value as Record<string, unknown>)) {
    const host = normalizeSignupHostname(rawHost)
    if (host === null || host !== rawHost) {
      throw new SignupAgentDefaultsConfigError(
        `signupAgentDefaults key ${JSON.stringify(rawHost)} is not an exact normalized hostname (lowercase, no scheme/port/path)`,
      )
    }
    if (typeof agentTypeId !== 'string' || !AGENT_TYPE_ID_PATTERN.test(agentTypeId)) {
      throw new SignupAgentDefaultsConfigError(
        `signupAgentDefaults[${JSON.stringify(host)}] must be an agent type id slug`,
      )
    }
    out[host] = agentTypeId
  }
  return Object.freeze(out)
}

/** A domain mapping cannot rely on the deliberately unbounded proxy mode. */
export function assertSignupAgentDefaultsUseBoundedProxy(
  signupAgentDefaults: SignupAgentDefaults,
  trustedProxy: unknown,
): void {
  if (
    Object.keys(signupAgentDefaults).length > 0
    && trustedProxy === 'legacy-unsafe'
  ) {
    throw new SignupAgentDefaultsConfigError(
      'signupAgentDefaults requires direct Host resolution or an exact bounded trusted proxy policy',
    )
  }
}

/**
 * Boot-time fleet validation: every mapping value must name a member of the
 * validated application fleet. Fail-fast before serving — an unknown fleet
 * member is a deployment configuration error, never a runtime fallback.
 */
export function assertSignupAgentDefaultsInFleet(
  signupAgentDefaults: SignupAgentDefaults | undefined,
  availableAgentTypeIds: readonly string[],
): void {
  if (!signupAgentDefaults) return
  for (const [host, agentTypeId] of Object.entries(signupAgentDefaults)) {
    if (!availableAgentTypeIds.includes(agentTypeId)) {
      throw new SignupAgentDefaultsConfigError(
        `signupAgentDefaults[${JSON.stringify(host)}] = ${JSON.stringify(agentTypeId)} is not a validated fleet member (fleet: ${availableAgentTypeIds.join(', ') || '<empty>'})`,
      )
    }
  }
}

/** Compile untrusted config input into the only mapping accepted by auth. */
export function compileSignupAgentDefaults(
  value: unknown,
  availableAgentTypeIds: readonly string[],
  trustedProxy: unknown,
): ValidatedSignupAgentDefaults {
  const signupAgentDefaults = parseSignupAgentDefaults(value)
  assertSignupAgentDefaultsInFleet(signupAgentDefaults, availableAgentTypeIds)
  assertSignupAgentDefaultsUseBoundedProxy(signupAgentDefaults, trustedProxy)
  return signupAgentDefaults as ValidatedSignupAgentDefaults
}

/**
 * Exact-hostname lookup consumed ONLY at new-default-workspace initialization.
 * No suffix/wildcard matching, no email-domain input, no fallback rewriting:
 * an unmapped or malformed hostname yields `undefined` and the ordinary boot
 * default applies.
 */
export function resolveSignupDefaultAgentTypeId(
  signupAgentDefaults: SignupAgentDefaults | undefined,
  signupHostname: string | null,
): string | undefined {
  if (!signupAgentDefaults || signupHostname === null) return undefined
  return Object.prototype.hasOwnProperty.call(signupAgentDefaults, signupHostname)
    ? signupAgentDefaults[signupHostname]
    : undefined
}
