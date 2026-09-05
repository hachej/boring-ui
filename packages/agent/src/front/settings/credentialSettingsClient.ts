import type {
  CredentialLifecycleStateV1,
  CredentialMetadataV1,
} from '../../shared/credentials'

export type CredentialFundingMethod = 'api-key' | 'openai-codex'

export type CredentialOAuthEvent =
  | { readonly type: 'auth_url'; readonly url: string }
  | { readonly type: 'device_code'; readonly userCode: string; readonly verificationUri: string; readonly expiresInSeconds?: number }
  | { readonly type: 'progress' }

export interface CredentialOAuthPrompt {
  readonly type: string
  readonly options?: readonly { readonly id: string; readonly label: string }[]
}

export interface CredentialOAuthFlow {
  readonly flowId: string
  readonly providerId: 'openai-codex'
  readonly status: 'pending' | 'succeeded' | 'failed' | 'cancelled'
  readonly events: readonly CredentialOAuthEvent[]
  readonly prompt?: CredentialOAuthPrompt
}

export interface CredentialSettingsClient {
  list(): Promise<readonly CredentialMetadataV1[]>
  putApiKey(providerId: string, apiKey: string): Promise<CredentialMetadataV1>
  disable(providerId: string): Promise<CredentialMetadataV1>
  revoke(providerId: string): Promise<CredentialMetadataV1>
  delete(providerId: string): Promise<CredentialMetadataV1>
  startCodexLogin(): Promise<CredentialOAuthFlow>
  getCodexLogin(flowId: string): Promise<CredentialOAuthFlow>
  respondToCodexLogin(flowId: string, value: string): Promise<CredentialOAuthFlow>
  cancelCodexLogin(flowId: string): Promise<void>
}

const STATES = new Set<string>([
  'active',
  'disabled',
  'revoked',
  'needs_reauth',
  'intentionally_absent',
  'instance_fallback_enabled',
  'not_configured',
])

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Credential service returned an invalid response')
  return value as Record<string, unknown>
}

/** Copy only the metadata contract's allowlisted fields. Unknown response fields
 * (including an accidentally returned secret) never enter component state. */
export function credentialMetadataFromResponse(value: unknown): CredentialMetadataV1 {
  const input = asRecord(value)
  if (
    typeof input.providerId !== 'string'
    || typeof input.displayName !== 'string'
    || typeof input.credentialType !== 'string'
    || typeof input.state !== 'string'
    || !STATES.has(input.state)
  ) throw new Error('Credential service returned an invalid response')
  return {
    providerId: input.providerId,
    displayName: input.displayName,
    credentialType: input.credentialType,
    state: input.state as CredentialLifecycleStateV1 | 'not_configured',
    ...(typeof input.credentialVersion === 'number' ? { credentialVersion: input.credentialVersion } : {}),
    ...(typeof input.maskedLastFourSuffix === 'string' ? { maskedLastFourSuffix: input.maskedLastFourSuffix.slice(-4) } : {}),
    ...(typeof input.createdAt === 'string' ? { createdAt: input.createdAt } : {}),
    ...(typeof input.updatedAt === 'string' ? { updatedAt: input.updatedAt } : {}),
  }
}

function oauthFlowFromResponse(value: unknown): CredentialOAuthFlow {
  const input = asRecord(value)
  if (
    typeof input.flowId !== 'string'
    || input.providerId !== 'openai-codex'
    || !['pending', 'succeeded', 'failed', 'cancelled'].includes(String(input.status))
    || !Array.isArray(input.events)
  ) throw new Error('Credential service returned an invalid sign-in response')

  const events: CredentialOAuthEvent[] = []
  for (const candidate of input.events) {
    const event = asRecord(candidate)
    if (event.type === 'progress') events.push({ type: 'progress' })
    if (event.type === 'auth_url' && typeof event.url === 'string' && event.url.startsWith('https://')) {
      events.push({ type: 'auth_url', url: event.url })
    }
    if (
      event.type === 'device_code'
      && typeof event.userCode === 'string'
      && typeof event.verificationUri === 'string'
      && event.verificationUri.startsWith('https://')
    ) {
      events.push({
        type: 'device_code',
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(typeof event.expiresInSeconds === 'number' ? { expiresInSeconds: event.expiresInSeconds } : {}),
      })
    }
  }
  let prompt: CredentialOAuthPrompt | undefined
  if (input.prompt && typeof input.prompt === 'object') {
    const rawPrompt = asRecord(input.prompt)
    if (typeof rawPrompt.type === 'string') {
      prompt = {
        type: rawPrompt.type,
        ...(Array.isArray(rawPrompt.options)
          ? {
              options: rawPrompt.options.flatMap((option) => {
                const item = asRecord(option)
                return typeof item.id === 'string' && typeof item.label === 'string'
                  ? [{ id: item.id, label: item.label }]
                  : []
              }),
            }
          : {}),
      }
    }
  }
  return {
    flowId: input.flowId,
    providerId: 'openai-codex',
    status: input.status as CredentialOAuthFlow['status'],
    events,
    ...(prompt ? { prompt } : {}),
  }
}

export function createCredentialSettingsClient(
  apiBaseUrl = '',
  fetchImpl: typeof fetch = fetch,
  requestHeaders?: Readonly<Record<string, string>>,
): CredentialSettingsClient {
  const base = apiBaseUrl.replace(/\/$/, '')
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(`${base}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...requestHeaders,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (!response.ok) throw new Error(response.status === 403 ? 'Only workspace owners can manage credentials.' : 'Credential operation failed. Try again.')
    return response.status === 204 ? undefined : response.json()
  }
  const metadataAction = async (providerId: string, suffix: string, method: string) =>
    credentialMetadataFromResponse(await request(`/api/v1/credentials/${encodeURIComponent(providerId)}${suffix}`, { method }))

  return {
    async list() {
      const payload = asRecord(await request('/api/v1/credentials'))
      if (!Array.isArray(payload.credentials)) throw new Error('Credential service returned an invalid response')
      return payload.credentials.map(credentialMetadataFromResponse)
    },
    async putApiKey(providerId, apiKey) {
      return credentialMetadataFromResponse(await request(`/api/v1/credentials/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields: { 'api-key': apiKey } }),
      }))
    },
    disable: (providerId) => metadataAction(providerId, '/disable', 'POST'),
    revoke: (providerId) => metadataAction(providerId, '/revoke', 'POST'),
    delete: (providerId) => metadataAction(providerId, '', 'DELETE'),
    async startCodexLogin() {
      return oauthFlowFromResponse(await request('/api/v1/credentials/openai-codex/oauth', { method: 'POST' }))
    },
    async getCodexLogin(flowId) {
      return oauthFlowFromResponse(await request(`/api/v1/credentials/openai-codex/oauth/${encodeURIComponent(flowId)}`))
    },
    async respondToCodexLogin(flowId, value) {
      return oauthFlowFromResponse(await request(`/api/v1/credentials/openai-codex/oauth/${encodeURIComponent(flowId)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ value }),
      }))
    },
    async cancelCodexLogin(flowId) {
      await request(`/api/v1/credentials/openai-codex/oauth/${encodeURIComponent(flowId)}`, { method: 'DELETE' })
    },
  }
}
