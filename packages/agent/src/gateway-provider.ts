// @hachej/boring-agent/gateway-provider: a native Pi provider whose models are served by a Boring model gateway
// (`@hachej/boring-agent/model-gateway` on the host, or a shared gateway service with the same API). Browser-safe: it knows only the
// gateway's base URL and the app session headers; it holds no model key and reads no environment. The wire is Pi's own
// `openai-completions` implementation pointed at `<baseUrl>/v1`, so streaming, tools and usage are native Pi behavior.
// Self-contained on purpose (ARCHITECTURE.json pathRules forbid its relative and node imports).
import { createProvider, type Provider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { Model } from '@earendil-works/pi-ai';

/** The provider id gateway models carry unless the host names another. */
export const GATEWAY_PROVIDER = 'boring-gateway';

/** A model the gateway allows, by its gateway id (the host maps it to an upstream model). */
export interface GatewayModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  /** Requested output ceiling; the gateway clamps it to the person's budget either way. */
  readonly maxTokens?: number;
  readonly input?: readonly ('text' | 'image')[];
}

export interface GatewayProviderOptions {
  /** The gateway root: `/api/llm` (resolved against the page) or an absolute URL. Requests go to `<baseUrl>/v1/...` only. */
  readonly baseUrl: string;
  readonly models: readonly (string | GatewayModel)[];
  /** The app session as request headers (for example `{ authorization: 'Bearer <session>' }`), read on every request. */
  readonly getAuth: () => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  readonly id?: string;
  readonly name?: string;
}

function absolute(baseUrl: string): string {
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  let url: URL;
  try { url = page ? new URL(baseUrl, page) : new URL(baseUrl); } catch { throw new TypeError('gatewayProvider needs an absolute baseUrl outside a page'); }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/v1`;
}

/** `models.setProvider(gatewayProvider({ baseUrl: '/api/llm', models: ['fernhill-preview'], getAuth }))`, then any Pi model call. */
export function gatewayProvider(options: GatewayProviderOptions): Provider<'openai-completions'> {
  if (typeof options.getAuth !== 'function') throw new TypeError('gatewayProvider needs getAuth()');
  const id = options.id ?? GATEWAY_PROVIDER;
  const baseUrl = absolute(options.baseUrl);
  const models: Model<'openai-completions'>[] = options.models.map(entry => {
    const model: GatewayModel = typeof entry === 'string' ? { id: entry } : entry;
    return {
      id: model.id, name: model.name ?? model.id, api: 'openai-completions', provider: id, baseUrl, reasoning: false,
      input: [...(model.input ?? ['text'])], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow ?? 128_000, maxTokens: model.maxTokens ?? 4096,
      // The gateway speaks plain chat completions: no stored responses, system prompts as `system`, usage in the stream.
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true, maxTokensField: 'max_completion_tokens' },
    };
  });
  return createProvider({
    id, name: options.name ?? 'Boring model gateway', baseUrl, models, api: openAICompletionsApi(),
    // The app session is the only credential: no API key exists on this side.
    auth: { apiKey: { name: 'App session', resolve: async () => ({ auth: { headers: { ...(await options.getAuth()) } }, source: 'app session' }) } },
  });
}
