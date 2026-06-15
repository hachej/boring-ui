import { getAgentDir, SettingsManager, type ModelRegistry } from '@mariozechner/pi-coding-agent'
import { getEnv } from '../config/env.js'

export interface AgentModelSelection {
  provider: string
  id: string
}

type ProviderConfigInput = Parameters<ModelRegistry['registerProvider']>[1]

const INFOMANIAK_PROVIDER = 'infomaniak'
const INFOMANIAK_API_BASE = 'https://api.infomaniak.com'
const DEFAULT_CUSTOM_MODEL_MAX_TOKENS = 16_384
const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 200_000

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = clean(getEnv(name))
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = clean(getEnv(name))?.toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

function readModelInput(name: string): Array<'text' | 'image'> {
  const raw = clean(getEnv(name))
  if (!raw) return ['text']
  const parsed = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is 'text' | 'image' => part === 'text' || part === 'image')
  return parsed.length > 0 ? parsed : ['text']
}

function readMaxTokensField(name: string): 'max_tokens' | 'max_completion_tokens' {
  const raw = clean(getEnv(name))
  return raw === 'max_tokens' || raw === 'max_completion_tokens' ? raw : 'max_completion_tokens'
}

// Some OpenAI-compatible gateways (e.g. Ollama) reject store/developer-role/
// reasoning-effort fields or want `max_tokens`; let hosts tune compat per
// provider env prefix instead of hardcoding OpenAI defaults.
function buildOpenAICompletionsCompat(envPrefix: string) {
  return {
    supportsStore: readBoolean(`${envPrefix}_SUPPORTS_STORE`, false),
    supportsDeveloperRole: readBoolean(`${envPrefix}_SUPPORTS_DEVELOPER_ROLE`, true),
    supportsReasoningEffort: readBoolean(`${envPrefix}_SUPPORTS_REASONING_EFFORT`, true),
    supportsUsageInStreaming: readBoolean(`${envPrefix}_SUPPORTS_USAGE_IN_STREAMING`, true),
    maxTokensField: readMaxTokensField(`${envPrefix}_MAX_TOKENS_FIELD`),
  }
}

function readApiKeyEnv(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const envName = clean(candidate)
    if (envName && clean(getEnv(envName))) return envName
  }
  return undefined
}

function buildOpenAICompatibleProviderConfig(opts: {
  modelId: string
  modelName?: string
  apiKeyEnv: string
  baseUrl: string
  envPrefix: string
}): ProviderConfigInput {
  return {
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKeyEnv,
    api: 'openai-completions',
    models: [
      {
        id: opts.modelId,
        name: opts.modelName ?? opts.modelId,
        api: 'openai-completions',
        reasoning: readBoolean(`${opts.envPrefix}_REASONING`, true),
        input: readModelInput(`${opts.envPrefix}_INPUT`),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: readPositiveInt(
          `${opts.envPrefix}_CONTEXT_WINDOW`,
          DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
        ),
        maxTokens: readPositiveInt(
          `${opts.envPrefix}_MAX_TOKENS`,
          DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
        ),
        compat: buildOpenAICompletionsCompat(opts.envPrefix),
      },
    ],
  }
}

function readInfomaniakBaseUrl(): string | undefined {
  const explicit = clean(getEnv('BORING_AGENT_INFOMANIAK_BASE_URL'))
  if (explicit) return explicit

  const productId = clean(getEnv('BORING_AGENT_INFOMANIAK_PRODUCT_ID'))
  if (!productId) return undefined
  return `${INFOMANIAK_API_BASE}/2/ai/${productId}/openai/v1`
}

function readInfomaniakProvider(): {
  provider: string
  config: ProviderConfigInput
  model: AgentModelSelection
} | undefined {
  const modelId = clean(getEnv('BORING_AGENT_INFOMANIAK_MODEL'))
    ?? clean(getEnv('BORING_AGENT_DEFAULT_MODEL_ID'))
  const baseUrl = readInfomaniakBaseUrl()
  const apiKeyEnv = readApiKeyEnv([
    clean(getEnv('BORING_AGENT_INFOMANIAK_API_KEY_ENV')) ?? '',
    'INFOMANIAK_API_TOKEN',
    'BORING_AGENT_INFOMANIAK_API_KEY',
  ])
  if (!modelId || !baseUrl || !apiKeyEnv) return undefined

  const provider = clean(getEnv('BORING_AGENT_INFOMANIAK_PROVIDER'))
    ?? INFOMANIAK_PROVIDER
  return {
    provider,
    model: { provider, id: modelId },
    config: buildOpenAICompatibleProviderConfig({
      modelId,
      modelName: clean(getEnv('BORING_AGENT_INFOMANIAK_MODEL_NAME')),
      apiKeyEnv,
      baseUrl,
      envPrefix: 'BORING_AGENT_INFOMANIAK',
    }),
  }
}

function readCustomProvider(): {
  provider: string
  config: ProviderConfigInput
  model: AgentModelSelection
} | undefined {
  const provider = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_PROVIDER'))
  const modelId = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_ID'))
  const baseUrl = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_BASE_URL'))
  const apiKeyEnv = readApiKeyEnv([
    clean(getEnv('BORING_AGENT_CUSTOM_MODEL_API_KEY_ENV')) ?? '',
    'BORING_AGENT_CUSTOM_MODEL_API_KEY',
  ])
  if (!provider || !modelId || !baseUrl || !apiKeyEnv) return undefined

  return {
    provider,
    model: { provider, id: modelId },
    config: buildOpenAICompatibleProviderConfig({
      modelId,
      modelName: clean(getEnv('BORING_AGENT_CUSTOM_MODEL_NAME')),
      apiKeyEnv,
      baseUrl,
      envPrefix: 'BORING_AGENT_CUSTOM_MODEL',
    }),
  }
}

export function registerConfiguredModelProviders(
  registry: Pick<ModelRegistry, 'registerProvider'>,
): AgentModelSelection[] {
  const registered: AgentModelSelection[] = []
  const seen = new Set<string>()
  for (const provider of [readInfomaniakProvider(), readCustomProvider()]) {
    if (!provider) continue
    if (seen.has(provider.provider)) continue
    registry.registerProvider(provider.provider, provider.config)
    registered.push(provider.model)
    seen.add(provider.provider)
  }
  return registered
}

function readPiSettingsDefaultModel(): AgentModelSelection | undefined {
  try {
    const settings = SettingsManager.create(process.cwd(), getAgentDir())
    const provider = clean(settings.getDefaultProvider())
    const id = clean(settings.getDefaultModel())
    return provider && id ? { provider, id } : undefined
  } catch {
    return undefined
  }
}

export function readConfiguredDefaultModel(): AgentModelSelection | undefined {
  const encoded = clean(getEnv('BORING_AGENT_DEFAULT_MODEL'))
  if (encoded) {
    const idx = encoded.indexOf(':')
    if (idx > 0 && idx < encoded.length - 1) {
      return { provider: encoded.slice(0, idx), id: encoded.slice(idx + 1) }
    }
  }

  const explicitProvider = clean(getEnv('BORING_AGENT_DEFAULT_MODEL_PROVIDER'))
  const explicitId = clean(getEnv('BORING_AGENT_DEFAULT_MODEL_ID'))
  if (explicitProvider && explicitId) {
    return { provider: explicitProvider, id: explicitId }
  }

  return readPiSettingsDefaultModel()
    ?? readInfomaniakProvider()?.model
    ?? readCustomProvider()?.model
}
