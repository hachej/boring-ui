import { randomUUID } from 'node:crypto'
import { ModelRuntime } from '@mariozechner/pi-coding-agent'
import type {
  AuthEvent,
  AuthPrompt,
  CredentialStore,
} from '@earendil-works/pi-ai'

const FLOW_TTL_MS = 15 * 60_000
const MAX_SAFE_EVENTS = 32

export type SafeOAuthEventV1 =
  | { readonly type: 'auth_url'; readonly url: string }
  | { readonly type: 'device_code'; readonly userCode: string; readonly verificationUri: string; readonly expiresInSeconds?: number }
  | { readonly type: 'progress' }

export interface SafeOAuthPromptV1 {
  readonly type: AuthPrompt['type']
  readonly options?: readonly { readonly id: string; readonly label: string }[]
}

export interface OAuthFlowSnapshotV1 {
  readonly flowId: string
  readonly providerId: 'openai-codex'
  readonly status: 'pending' | 'succeeded' | 'failed' | 'cancelled'
  readonly events: readonly SafeOAuthEventV1[]
  readonly prompt?: SafeOAuthPromptV1
  readonly createdAt: string
  readonly completedAt?: string
}

export interface CodexDisconnectResultV1 {
  /** Pi logout is local credential orchestration; it does not currently attest upstream revocation. */
  readonly logoutStatus: 'completed' | 'failed'
  readonly upstreamStatus: 'pending'
}

export interface OpenAiCodexOAuthBrokerV1 {
  start(workspaceId: string, userId: string): Promise<OAuthFlowSnapshotV1>
  get(workspaceId: string, userId: string, flowId: string): OAuthFlowSnapshotV1 | undefined
  respond(workspaceId: string, userId: string, flowId: string, value: string): Promise<OAuthFlowSnapshotV1>
  cancel(workspaceId: string, userId: string, flowId: string): Promise<void>
  disconnect(workspaceId: string, userId: string): Promise<CodexDisconnectResultV1>
}

export interface OpenAiCodexOAuthBrokerOptionsV1 {
  readonly credentialStoreForActor: (workspaceId: string, userId: string) => CredentialStore | Promise<CredentialStore>
  readonly createRuntime?: (credentials: CredentialStore) => Promise<Pick<ModelRuntime, 'login' | 'logout'>>
  readonly now?: () => number
}

interface PendingPrompt {
  readonly projection: SafeOAuthPromptV1
  readonly selectValues?: readonly string[]
  readonly resolve: (value: string) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
}

interface Flow {
  readonly flowId: string
  readonly workspaceId: string
  readonly userId: string
  readonly createdAtMs: number
  readonly abort: AbortController
  status: OAuthFlowSnapshotV1['status']
  events: SafeOAuthEventV1[]
  prompt?: PendingPrompt
  completedAt?: string
}

function safeHttpsUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function safeEvent(event: AuthEvent): SafeOAuthEventV1 | undefined {
  if (event.type === 'auth_url') {
    const url = safeHttpsUrl(event.url)
    return url ? { type: 'auth_url', url } : undefined
  }
  if (event.type === 'device_code') {
    const verificationUri = safeHttpsUrl(event.verificationUri)
    if (!verificationUri || event.userCode.length > 128) return undefined
    return {
      type: 'device_code',
      userCode: event.userCode,
      verificationUri,
      ...(event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds }),
    }
  }
  // Never project provider-authored text. It could accidentally contain a token.
  return { type: 'progress' }
}

function safePrompt(prompt: AuthPrompt): {
  readonly projection: SafeOAuthPromptV1
  readonly selectValues?: readonly string[]
} {
  if (prompt.type !== 'select') return { projection: { type: prompt.type } }
  const options = prompt.options.slice(0, 32)
  return {
    // Provider-authored option ids and labels are not safe response data. Use
    // opaque positional ids and translate them back only inside the broker.
    projection: {
      type: prompt.type,
      options: options.map((_, index) => ({ id: String(index), label: `Option ${index + 1}` })),
    },
    selectValues: options.map((option) => option.id),
  }
}

function snapshot(flow: Flow): OAuthFlowSnapshotV1 {
  return Object.freeze({
    flowId: flow.flowId,
    providerId: 'openai-codex' as const,
    status: flow.status,
    events: Object.freeze(flow.events.map((event) => Object.freeze({ ...event }))),
    ...(flow.prompt ? { prompt: Object.freeze({ ...flow.prompt.projection }) } : {}),
    createdAt: new Date(flow.createdAtMs).toISOString(),
    ...(flow.completedAt ? { completedAt: flow.completedAt } : {}),
  })
}

export function createOpenAiCodexOAuthBrokerV1(
  options: OpenAiCodexOAuthBrokerOptionsV1,
): OpenAiCodexOAuthBrokerV1 {
  const flows = new Map<string, Flow>()
  const disconnectingActors = new Set<string>()
  const actorEpochs = new Map<string, number>()
  const now = options.now ?? Date.now
  const runtimeFactory = options.createRuntime ?? (async (credentials) => ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
  }))

  const requireFlow = (workspaceId: string, userId: string, flowId: string): Flow => {
    const flow = flows.get(flowId)
    if (!flow || flow.workspaceId !== workspaceId || flow.userId !== userId || now() - flow.createdAtMs > FLOW_TTL_MS) {
      throw new Error('OAuth flow not found')
    }
    return flow
  }

  const actorKey = (workspaceId: string, userId: string) => `${workspaceId}\u0000${userId}`
  const cancelFlow = (flow: Flow): void => {
    flow.abort.abort(new Error('OAuth flow cancelled'))
    flow.prompt?.reject(new Error('OAuth flow cancelled'))
    flow.prompt = undefined
    flow.status = 'cancelled'
    flow.completedAt = new Date(now()).toISOString()
  }

  const broker: OpenAiCodexOAuthBrokerV1 = {
    async start(workspaceId, userId) {
      if (!workspaceId.trim() || !userId.trim()) throw new Error('OAuth actor is invalid')
      const key = actorKey(workspaceId, userId)
      if (disconnectingActors.has(key)) throw new Error('OAuth disconnect is in progress')
      const epoch = actorEpochs.get(key) ?? 0
      // Capture the actor's durable credential version before this flow exists.
      // The login-only store uses it to reject a newer cross-process revoke.
      const credentials = await options.credentialStoreForActor(workspaceId, userId)
      if (disconnectingActors.has(key) || (actorEpochs.get(key) ?? 0) !== epoch) {
        throw new Error('OAuth flow was superseded by disconnect')
      }
      const flow: Flow = {
        flowId: randomUUID(),
        workspaceId,
        userId,
        createdAtMs: now(),
        abort: new AbortController(),
        status: 'pending',
        events: [],
      }
      flows.set(flow.flowId, flow)
      void (async () => {
        try {
          const runtime = await runtimeFactory(credentials)
          await runtime.login('openai-codex', 'oauth', {
            signal: flow.abort.signal,
            notify(event) {
              const projected = safeEvent(event)
              if (!projected) return
              flow.events.push(projected)
              if (flow.events.length > MAX_SAFE_EVENTS) flow.events.shift()
            },
            prompt(prompt) {
              if (flow.prompt) return Promise.reject(new Error('OAuth prompt already pending'))
              return new Promise<string>((resolve, reject) => {
                const safe = safePrompt(prompt)
                const pending: PendingPrompt = {
                  projection: safe.projection,
                  selectValues: safe.selectValues,
                  resolve,
                  reject,
                  signal: prompt.signal,
                }
                flow.prompt = pending
                prompt.signal?.addEventListener('abort', () => {
                  if (flow.prompt !== pending) return
                  flow.prompt = undefined
                  reject(prompt.signal?.reason ?? new Error('OAuth prompt cancelled'))
                }, { once: true })
              })
            },
          })
          flow.abort.signal.throwIfAborted()
          flow.status = 'succeeded'
        } catch {
          flow.status = flow.abort.signal.aborted ? 'cancelled' : 'failed'
        } finally {
          flow.prompt = undefined
          flow.completedAt = new Date(now()).toISOString()
        }
      })()
      return snapshot(flow)
    },
    get(workspaceId, userId, flowId) {
      try {
        return snapshot(requireFlow(workspaceId, userId, flowId))
      } catch {
        return undefined
      }
    },
    async respond(workspaceId, userId, flowId, value) {
      const flow = requireFlow(workspaceId, userId, flowId)
      if (flow.status !== 'pending' || !flow.prompt || typeof value !== 'string' || value.length > 8_192) {
        throw new Error('OAuth flow is not awaiting input')
      }
      const pending = flow.prompt
      const selected = pending.selectValues
        ? (/^(0|[1-9]\d*)$/.test(value) ? pending.selectValues[Number(value)] : undefined)
        : value
      if (selected === undefined) throw new Error('OAuth flow selection is invalid')
      flow.prompt = undefined
      pending.resolve(selected)
      return snapshot(flow)
    },
    async cancel(workspaceId, userId, flowId) {
      cancelFlow(requireFlow(workspaceId, userId, flowId))
    },
    async disconnect(workspaceId, userId) {
      if (!workspaceId.trim() || !userId.trim()) throw new Error('OAuth actor is invalid')
      const key = actorKey(workspaceId, userId)
      if (disconnectingActors.has(key)) throw new Error('OAuth disconnect is already in progress')
      actorEpochs.set(key, (actorEpochs.get(key) ?? 0) + 1)
      disconnectingActors.add(key)
      try {
        // Fence all pre-disconnect login tasks before local deletion. Their
        // AbortSignal is also checked immediately before successful completion.
        for (const flow of flows.values()) {
          if (flow.workspaceId === workspaceId && flow.userId === userId && flow.status === 'pending') {
            cancelFlow(flow)
          }
        }
        try {
          const credentials = await options.credentialStoreForActor(workspaceId, userId)
          const runtime = await runtimeFactory(credentials)
          await runtime.logout('openai-codex')
          return Object.freeze({ logoutStatus: 'completed', upstreamStatus: 'pending' })
        } catch {
          // Pi currently exposes local logout, but no upstream revocation receipt.
          // The route still persists a fail-closed local revoked state.
          return Object.freeze({ logoutStatus: 'failed', upstreamStatus: 'pending' })
        }
      } finally {
        disconnectingActors.delete(key)
      }
    },
  }
  return Object.freeze(broker)
}
