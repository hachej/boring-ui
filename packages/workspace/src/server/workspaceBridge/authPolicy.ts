import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeActorAttribution,
  type BridgeAuthContext,
  type BridgeCallerClass,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"

export interface BridgePrincipal {
  userId: string
  email?: string
  roles?: readonly string[]
}

export interface BridgeWorkspaceGrant {
  allowed: boolean
  role?: string
  capabilities: readonly string[]
  resourceScope?: Record<string, unknown>
}

export interface BridgeAuthPolicyRequestLike {
  headers?: Record<string, string | string[] | undefined>
  method?: string
  /** Host-authenticated principal attached to the Fastify request, if available. */
  user?: unknown
}

export interface BridgeAuthPolicyInput {
  callerClass: BridgeCallerClass
  definition: WorkspaceBridgeOperationDefinition
  workspaceId: string
  sessionId?: string
  pluginId?: string
  request?: BridgeAuthPolicyRequestLike
  body?: unknown
  requiredCapabilities?: readonly string[]
}

export interface BridgeAuthResolution {
  context: BridgeAuthContext
  effectiveCapabilities: readonly string[]
  resourceScope?: Record<string, unknown>
  principal?: BridgePrincipal
}

export interface BridgeAuthPolicy {
  resolve(input: BridgeAuthPolicyInput): Promise<BridgeAuthResolution> | BridgeAuthResolution
}

export interface BrowserBridgeAuthPolicyOptions {
  getPrincipal(input: BridgeAuthPolicyInput): Promise<BridgePrincipal | null> | BridgePrincipal | null
  authorizeWorkspace(input: {
    principal: BridgePrincipal
    workspaceId: string
    sessionId?: string
    definition: WorkspaceBridgeOperationDefinition
    request?: BridgeAuthPolicyRequestLike
  }): Promise<BridgeWorkspaceGrant> | BridgeWorkspaceGrant
  allowedOrigins?: readonly string[]
  /**
   * Require a non-empty x-csrf-token header as a non-simple-request proof.
   * This policy does not validate a signed token value; hosts that need
   * cryptographic CSRF tokens should verify them before/inside getPrincipal.
   */
  requireCsrfHeader?: boolean
}

export interface LocalCliBridgeAuthPolicyOptions {
  workspaceId: string
  capabilities?: readonly string[]
  /**
   * Single-tenant/dev hosts may still pass a cosmetic x-boring-workspace-id
   * header from the front shell. When true, authenticate all browser bridge
   * calls as the configured owner workspace instead of rejecting that alias.
   * Multi-workspace CLI mode must leave this false.
   */
  forceOwnerWorkspaceId?: boolean
}

export function createBrowserBridgeAuthPolicy(
  options: BrowserBridgeAuthPolicyOptions,
): BridgeAuthPolicy {
  return {
    async resolve(input) {
      if (input.callerClass !== "browser") {
        throw createWorkspaceBridgeError(
          WorkspaceBridgeErrorCode.CallerNotAllowed,
          "Browser auth policy only accepts browser callers",
        )
      }
      ensureCallerAllowed(input.definition, "browser")
      ensureBrowserRequestAllowed(input, options)

      const principal = await options.getPrincipal(input)
      if (!principal) {
        throw createWorkspaceBridgeError(
          WorkspaceBridgeErrorCode.AuthRequired,
          "Browser bridge caller is not authenticated",
        )
      }

      const grant = await options.authorizeWorkspace({
        principal,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        definition: input.definition,
        request: input.request,
      })
      if (!grant.allowed) {
        throw createWorkspaceBridgeError(
          WorkspaceBridgeErrorCode.ResourceScopeDenied,
          "Browser bridge caller is not authorized for workspace",
        )
      }

      const capabilities = grant.capabilities
      ensureCapabilities(capabilities, input.requiredCapabilities ?? input.definition.requiredCapabilities)

      const context = makeContext({
        callerClass: "browser",
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        pluginId: input.pluginId,
        capabilities,
        actor: {
          actorKind: "human",
          performedBy: {
            label: principal.email ? `user:${principal.email}` : `user:${principal.userId}`,
            id: principal.userId,
          },
        },
      })

      return {
        context,
        effectiveCapabilities: capabilities,
        principal,
        resourceScope: {
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          role: grant.role,
          ...grant.resourceScope,
        },
      }
    },
  }
}

/**
 * Dev/local CLI only. This policy performs no user authentication and grants
 * the configured capabilities (defaulting to the op's own) to a fixed
 * local-cli principal. Do not use it for exposed or production servers; pass a
 * host-owned createBrowserBridgeAuthPolicy-style policy instead.
 */
export function createLocalCliBridgeAuthPolicy(
  options: LocalCliBridgeAuthPolicyOptions,
): BridgeAuthPolicy {
  // Trusted local/dev only: no Better Auth / core DB.
  return {
    resolve(input) {
      if (input.callerClass !== "browser") {
        throw createWorkspaceBridgeError(
          WorkspaceBridgeErrorCode.CallerNotAllowed,
          "Local CLI auth policy only accepts browser callers",
        )
      }
      ensureCallerAllowed(input.definition, "browser")
      if (!options.forceOwnerWorkspaceId && input.workspaceId !== options.workspaceId) {
        throw createWorkspaceBridgeError(
          WorkspaceBridgeErrorCode.ResourceScopeDenied,
          "Local CLI bridge caller is not authorized for workspace",
        )
      }
      const workspaceId = options.forceOwnerWorkspaceId ? options.workspaceId : input.workspaceId
      const capabilities = options.capabilities ?? input.definition.requiredCapabilities
      ensureCapabilities(capabilities, input.requiredCapabilities ?? input.definition.requiredCapabilities)
      const context = makeContext({
        callerClass: "browser",
        workspaceId,
        sessionId: input.sessionId,
        pluginId: input.pluginId,
        capabilities,
        actor: { actorKind: "human", performedBy: { id: "local", label: "local-cli:user" } },
      })
      return {
        context,
        effectiveCapabilities: capabilities,
        principal: { userId: "local" },
        resourceScope: { workspaceId, sessionId: input.sessionId },
      }
    },
  }
}

function ensureCallerAllowed(
  definition: WorkspaceBridgeOperationDefinition,
  callerClass: BridgeCallerClass,
): void {
  if (!definition.callerClassesAllowed.includes(callerClass)) {
    throw createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.CallerNotAllowed,
      "Bridge caller class is not allowed for operation",
    )
  }
}

function ensureCapabilities(
  actual: readonly string[],
  required: readonly string[],
): void {
  const missing = required.find((capability) => !actual.includes(capability))
  if (missing) {
    throw createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.CapabilityDenied,
      "Bridge caller is missing a required capability",
    )
  }
}

function ensureBrowserRequestAllowed(
  input: BridgeAuthPolicyInput,
  options: BrowserBridgeAuthPolicyOptions,
): void {
  if (options.allowedOrigins && options.allowedOrigins.length > 0) {
    const origin = firstHeader(input.request?.headers, "origin")
    if (!origin || !options.allowedOrigins.includes(origin)) {
      throw createWorkspaceBridgeError(
        WorkspaceBridgeErrorCode.AuthRequired,
        "Browser bridge request origin is not allowed",
      )
    }
  }
  if (options.requireCsrfHeader) {
    const csrf = firstHeader(input.request?.headers, "x-csrf-token")
    if (!csrf) {
      throw createWorkspaceBridgeError(
        WorkspaceBridgeErrorCode.AuthRequired,
        "Browser bridge request is missing CSRF proof",
      )
    }
  }
}

function firstHeader(
  headers: BridgeAuthPolicyRequestLike["headers"] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  const direct = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(direct) ? direct[0] : direct
}

function makeContext(context: BridgeAuthContext): BridgeAuthContext {
  return {
    ...context,
    capabilities: [...context.capabilities],
    actor: sanitizeActor(context.actor),
  }
}

function sanitizeActor(actor: BridgeActorAttribution): BridgeActorAttribution {
  return {
    actorKind: actor.actorKind,
    performedBy: actor.performedBy
      ? { label: actor.performedBy.label, id: actor.performedBy.id }
      : undefined,
    onBehalfOf: actor.onBehalfOf
      ? { label: actor.onBehalfOf.label, id: actor.onBehalfOf.id }
      : undefined,
  }
}
