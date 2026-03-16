import { getPiRuntime } from './runtime'

const KNOWN_PI_PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Used for Claude models and the default agent setup.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Used when you switch the agent to an OpenAI-backed model.',
  },
  {
    id: 'google',
    label: 'Google',
    description: 'Used when you switch the agent to a Gemini-backed model.',
  },
]

const providerLabelFromId = (providerId) => {
  const normalized = String(providerId || '').trim()
  if (!normalized) return 'Provider'
  return normalized
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

export const maskPiProviderKey = (value) => {
  const key = String(value || '').trim()
  if (!key) return ''
  if (key.length <= 4) {
    return '••••'
  }
  if (key.length <= 12) {
    return `${key.slice(0, 2)}...${key.slice(-2)}`
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

const providerDefinitionFromId = (providerId) => {
  const known = KNOWN_PI_PROVIDERS.find((provider) => provider.id === providerId)
  if (known) return known
  return {
    id: providerId,
    label: providerLabelFromId(providerId),
    description: 'Saved locally for a custom agent provider.',
  }
}

const createAnonymousScopeId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `anon-${globalThis.crypto.randomUUID()}`
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function resolvePiProviderKeyScope(userScope = '') {
  const normalizedUserScope = String(userScope || '').trim()
  if (normalizedUserScope) return normalizedUserScope

  const storageKey = 'boring-ui-pi-provider-key-scope'
  try {
    const existing = globalThis.window?.localStorage?.getItem(storageKey)
    if (existing) return existing
    const created = createAnonymousScopeId()
    globalThis.window?.localStorage?.setItem(storageKey, created)
    return created
  } catch {
    return createAnonymousScopeId()
  }
}

export async function listPiProviderKeyStatus(userScope = '') {
  const runtime = getPiRuntime(resolvePiProviderKeyScope(userScope))
  const savedProviderIds = await runtime.providerKeys.list()
  const orderedProviderIds = [
    ...KNOWN_PI_PROVIDERS.map((provider) => provider.id),
    ...savedProviderIds.filter((providerId) => !KNOWN_PI_PROVIDERS.some((provider) => provider.id === providerId)),
  ]

  return Promise.all(
    orderedProviderIds.map(async (providerId) => {
      const value = String((await runtime.providerKeys.get(providerId)) || '').trim()
      return {
        ...providerDefinitionFromId(providerId),
        hasKey: Boolean(value),
        maskedKey: value ? maskPiProviderKey(value) : '',
      }
    }),
  )
}

export async function setPiProviderKey(userScope = '', providerId, key) {
  const normalizedProviderId = String(providerId || '').trim()
  const normalizedKey = String(key || '').trim()
  if (!normalizedProviderId) {
    throw new Error('Provider is required')
  }
  if (!normalizedKey) {
    throw new Error('API key is required')
  }
  const runtime = getPiRuntime(resolvePiProviderKeyScope(userScope))
  await runtime.providerKeys.set(normalizedProviderId, normalizedKey)
  return {
    providerId: normalizedProviderId,
    maskedKey: maskPiProviderKey(normalizedKey),
  }
}

export async function removePiProviderKey(userScope = '', providerId) {
  const normalizedProviderId = String(providerId || '').trim()
  if (!normalizedProviderId) {
    throw new Error('Provider is required')
  }
  const runtime = getPiRuntime(resolvePiProviderKeyScope(userScope))
  await runtime.providerKeys.delete(normalizedProviderId)
}
