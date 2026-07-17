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
const DEFAULT_INFOMANIAK_MODELS = [
  'moonshotai/Kimi-K2.6',
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
  'Qwen/Qwen3.5-122B-A10B-FP8',
]

type OpenAICompletionsCompatDefaults = Partial<{
  supportsStore: boolean
  supportsDeveloperRole: boolean
  supportsReasoningEffort: boolean
  supportsUsageInStreaming: boolean
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
}>

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

function readMaxTokensField(
  name: string,
  fallback: 'max_tokens' | 'max_completion_tokens' = 'max_completion_tokens',
): 'max_tokens' | 'max_completion_tokens' {
  const raw = clean(getEnv(name))
  return raw === 'max_tokens' || raw === 'max_completion_tokens' ? raw : fallback
}

// Some OpenAI-compatible gateways (e.g. Ollama/Infomaniak) reject store,
// developer-role, reasoning-effort fields or want `max_tokens`; let hosts tune
// compat per provider env prefix instead of hardcoding OpenAI defaults.
function buildOpenAICompletionsCompat(
  envPrefix: string,
  defaults: OpenAICompletionsCompatDefaults = {},
) {
  return {
    supportsStore: readBoolean(`${envPrefix}_SUPPORTS_STORE`, defaults.supportsStore ?? false),
    supportsDeveloperRole: readBoolean(`${envPrefix}_SUPPORTS_DEVELOPER_ROLE`, defaults.supportsDeveloperRole ?? true),
    supportsReasoningEffort: readBoolean(`${envPrefix}_SUPPORTS_REASONING_EFFORT`, defaults.supportsReasoningEffort ?? true),
    supportsUsageInStreaming: readBoolean(`${envPrefix}_SUPPORTS_USAGE_IN_STREAMING`, defaults.supportsUsageInStreaming ?? true),
    maxTokensField: readMaxTokensField(`${envPrefix}_MAX_TOKENS_FIELD`, defaults.maxTokensField),
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
  models: Array<{ id: string; name?: string }>
  apiKeyEnv: string
  baseUrl: string
  envPrefix: string
  compatDefaults?: OpenAICompletionsCompatDefaults
}): ProviderConfigInput {
  return {
    baseUrl: opts.baseUrl,
    // pi-coding-agent 0.80.7 resolves `$ENV_VAR` config references through
    // the provider environment. A bare name is a literal API key, which would
    // send "INFOMANIAK_API_TOKEN" as the bearer token and cause provider 401s.
    apiKey: `$${opts.apiKeyEnv}`,
    api: 'openai-completions',
    models: opts.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
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
      compat: buildOpenAICompletionsCompat(opts.envPrefix, opts.compatDefaults),
    })),
  }
}

function readInfomaniakBaseUrl(): string | undefined {
  const explicit = clean(getEnv('BORING_AGENT_INFOMANIAK_BASE_URL'))
  if (explicit) return explicit

  const productId = clean(getEnv('BORING_AGENT_INFOMANIAK_PRODUCT_ID'))
  if (!productId) return undefined
  return `${INFOMANIAK_API_BASE}/2/ai/${productId}/openai/v1`
}

function readInfomaniakModelIds(): string[] {
  const configured = clean(getEnv('BORING_AGENT_INFOMANIAK_MODELS'))
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const ids = configured?.length ? configured : [...DEFAULT_INFOMANIAK_MODELS]
  const legacyModel = clean(getEnv('BORING_AGENT_INFOMANIAK_MODEL'))
  if (legacyModel && !ids.includes(legacyModel)) ids.push(legacyModel)
  return Array.from(new Set(ids))
}

function readInfomaniakProvider(): {
  provider: string
  config: ProviderConfigInput
  models: AgentModelSelection[]
  defaultModel: AgentModelSelection
} | undefined {
  const modelIds = readInfomaniakModelIds()
  const defaultModelId = clean(getEnv('BORING_AGENT_INFOMANIAK_MODEL'))
    ?? clean(getEnv('BORING_AGENT_DEFAULT_MODEL_ID'))
    ?? modelIds[0]
  const baseUrl = readInfomaniakBaseUrl()
  const apiKeyEnv = readApiKeyEnv([
    clean(getEnv('BORING_AGENT_INFOMANIAK_API_KEY_ENV')) ?? '',
    'INFOMANIAK_API_TOKEN',
    'BORING_AGENT_INFOMANIAK_API_KEY',
  ])
  if (!defaultModelId || !baseUrl || !apiKeyEnv) return undefined

  const provider = clean(getEnv('BORING_AGENT_INFOMANIAK_PROVIDER'))
    ?? INFOMANIAK_PROVIDER
  const modelName = clean(getEnv('BORING_AGENT_INFOMANIAK_MODEL_NAME'))
  const models = modelIds.map((id) => {
    const model: { id: string; name?: string } = { id }
    if (id === defaultModelId && modelName) model.name = modelName
    return model
  })
  if (!models.some((model) => model.id === defaultModelId)) {
    models.push({ id: defaultModelId, name: modelName })
  }
  return {
    provider,
    models: models.map((model) => ({ provider, id: model.id })),
    defaultModel: { provider, id: defaultModelId },
    config: buildOpenAICompatibleProviderConfig({
      models,
      apiKeyEnv,
      baseUrl,
      envPrefix: 'BORING_AGENT_INFOMANIAK',
      // Infomaniak's OpenAI-compatible chat endpoint rejects OpenAI's newer
      // `developer` role (surfacing as "400 Unexpected message role"). Hosts
      // can opt back in with BORING_AGENT_INFOMANIAK_SUPPORTS_DEVELOPER_ROLE=1.
      compatDefaults: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    }),
  }
}

function readCustomProvider(): {
  provider: string
  config: ProviderConfigInput
  models: AgentModelSelection[]
  defaultModel: AgentModelSelection
} | undefined {
  const provider = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_PROVIDER'))
  const modelId = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_ID'))
  const baseUrl = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_BASE_URL'))
  const apiKeyEnv = readApiKeyEnv([
    clean(getEnv('BORING_AGENT_CUSTOM_MODEL_API_KEY_ENV')) ?? '',
    'BORING_AGENT_CUSTOM_MODEL_API_KEY',
  ])
  if (!provider || !modelId || !baseUrl || !apiKeyEnv) return undefined

  const modelName = clean(getEnv('BORING_AGENT_CUSTOM_MODEL_NAME'))
  const model: { id: string; name?: string } = { id: modelId }
  if (modelName) model.name = modelName
  return {
    provider,
    models: [{ provider, id: modelId }],
    defaultModel: { provider, id: modelId },
    config: buildOpenAICompatibleProviderConfig({
      models: [model],
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
    registered.push(...provider.models)
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
    ?? readInfomaniakProvider()?.defaultModel
    ?? readCustomProvider()?.defaultModel
}
