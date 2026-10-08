// Model access from a browser. Credentials (API keys, OAuth tokens) live in the browser's SQLite database behind a pi-ai
// `CredentialStore`, and pi-ai resolves and refreshes them as usual. The host registers whichever pi-ai providers it
// wants; this module lists them for a settings UI, saves API keys and runs the device-code sign-in a subscription
// provider offers. Which model a conversation uses stays where Pi keeps it: the conversation's native agent configuration.
//
// pi-ai loads its OAuth flows through an import a bundler cannot follow (it keeps Node-only callback servers out of
// bundles), so a bundled worker would fail to sign in. `openBrowserModels` registers pi-ai's statically linked flows
// (`@earendil-works/pi-ai/bun-oauth`, upstream's hook for single-file builds); the device-code flows run unchanged and
// the browser bundle shims (`@hachej/boring-browser/build`) stand in for the Node modules the other flows import.
import { createModels } from '@earendil-works/pi-ai/models';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import type { MutableModels, Provider } from '@earendil-works/pi-ai/models';
import type { AuthEvent, AuthPrompt, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
import type { Conversation, ModelRef } from '@earendil-works/pi-durable';
import type { SqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite';
import type { Context } from '@earendil-works/chord';
import { guardStatus, readJsonBody } from '@hachej/boring-files/request-guard';

/** A pi-ai `CredentialStore` over one SQLite table. `modify` is serialized, as the contract requires. */
export async function createSqliteCredentialStore(db: SqliteDatabase): Promise<CredentialStore> {
  await db.exec('CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, credential TEXT NOT NULL)');
  let chain: Promise<unknown> = Promise.resolve();
  const read = async (providerId: string): Promise<Credential | undefined> => {
    const row = await db.get<{ credential: string }>('SELECT credential FROM credentials WHERE provider = ?', providerId);
    return row ? JSON.parse(row.credential) as Credential : undefined;
  };
  return {
    read,
    list: async (): Promise<readonly CredentialInfo[]> => (await db.all<{ provider: string; credential: string }>('SELECT provider, credential FROM credentials'))
      .map(row => ({ providerId: row.provider, type: (JSON.parse(row.credential) as Credential).type })),
    modify: (providerId, change) => {
      const next = chain.then(async () => {
        const value = await change(await read(providerId));
        if (value === undefined) await db.run('DELETE FROM credentials WHERE provider = ?', providerId);
        else await db.run('INSERT OR REPLACE INTO credentials (provider, credential) VALUES (?, ?)', providerId, JSON.stringify(value));
        return value;
      });
      chain = next.catch(() => {});
      return next;
    },
    delete: async providerId => { await db.run('DELETE FROM credentials WHERE provider = ?', providerId); },
  };
}

/** One provider as a settings UI shows it. */
export interface ProviderCatalogEntry {
  readonly id: string;
  readonly name: string;
  /** Its models, the host's preferred default first (see `defaultModels`). */
  readonly models: readonly { readonly id: string; readonly name: string }[];
  /** Ways to authorize it: `api_key`, `oauth` (a subscription sign-in) or both. */
  readonly auth: readonly ('api_key' | 'oauth')[];
  /** pi-ai resolves auth for it now: a stored credential, or a provider that needs none. */
  readonly configured: boolean;
  readonly loginLabel?: string;
}

export interface BrowserModelsOptions {
  readonly db: SqliteDatabase;
  /** Any pi-ai providers (`openaiProvider()`, `anthropicProvider()`, a provider from `@earendil-works/pi-ai/providers/*`, or your own), or factories for them. */
  readonly providers: readonly (Provider | (() => Provider))[];
  /** The model a settings UI should offer first for a provider; other providers list their models in their own order. */
  readonly defaultModels?: Readonly<Record<string, string>>;
}

export interface DeviceCodeLogin {
  /** Called once with the code to show and the page where the person enters it. */
  readonly onCode: (code: { readonly userCode: string; readonly verificationUri: string }) => void;
  readonly signal?: AbortSignal;
}

export interface BrowserModels {
  readonly models: MutableModels;
  readonly credentials: CredentialStore;
  /** Every registered provider with its models, auth kinds and whether it is configured. */
  catalog(): Promise<ProviderCatalogEntry[]>;
  /** Store an API key for a provider. */
  saveApiKey(providerId: string, key: string): Promise<void>;
  /** Run the provider's OAuth device-code sign-in; resolves when the person approved and the credential is stored. */
  loginDeviceCode(providerId: string, login: DeviceCodeLogin): Promise<void>;
  /** Remove a provider's stored credential. */
  logout(providerId: string): Promise<void>;
  /** The provider's default model (see `defaultModels`, else its first), or undefined when it has none. */
  defaultModelId(providerId: string): string | undefined;
}

/** Open model access over one SQLite database. */
export async function openBrowserModels(options: BrowserModelsOptions): Promise<BrowserModels> {
  registerBunOAuthFlows();
  const credentials = await createSqliteCredentialStore(options.db);
  const models = createModels({ credentials });
  for (const provider of options.providers) models.setProvider(typeof provider === 'function' ? provider() : provider);

  // The preferred default first, the rest in the provider's own order.
  const ordered = (providerId: string) => {
    const list = models.getModels(providerId), preferred = options.defaultModels?.[providerId];
    return preferred ? [...list.filter(model => model.id === preferred), ...list.filter(model => model.id !== preferred)] : list;
  };
  const configured = async (providerId: string): Promise<boolean> => {
    try { return await models.getAuth(providerId) !== undefined; } catch { return false; } // a broken credential is not configured
  };
  return {
    models, credentials,
    defaultModelId: providerId => ordered(providerId)[0]?.id,
    async catalog() {
      return Promise.all(models.getProviders().map(async provider => ({
        id: provider.id, name: provider.name,
        models: ordered(provider.id).map(model => ({ id: model.id, name: model.name })),
        auth: [...(provider.auth.apiKey ? ['api_key' as const] : []), ...(provider.auth.oauth ? ['oauth' as const] : [])],
        configured: await configured(provider.id),
        ...(provider.auth.oauth?.loginLabel ? { loginLabel: provider.auth.oauth.loginLabel } : {}),
      })));
    },
    async saveApiKey(providerId, key) {
      const provider = models.getProvider(providerId);
      if (!provider?.auth.apiKey) throw new Error(`${providerId} does not use an API key`);
      if (!key.trim()) throw new Error('The API key is empty');
      await credentials.modify(providerId, async () => ({ type: 'api_key', key: key.trim() }));
    },
    async loginDeviceCode(providerId, { onCode, signal }) {
      if (!models.getProvider(providerId)?.auth.oauth) throw new Error(`${providerId} has no sign-in`);
      await models.login(providerId, 'oauth', {
        ...(signal ? { signal } : {}),
        prompt: async (prompt: AuthPrompt) => {
          if (prompt.type === 'select') return (prompt.options.find(option => /device/i.test(option.id) || /device/i.test(option.label)) ?? prompt.options.at(-1))!.id;
          throw new Error(`Unexpected sign-in prompt: ${prompt.message}`);
        },
        notify: (event: AuthEvent) => { if (event.type === 'device_code') onCode({ userCode: event.userCode, verificationUri: event.verificationUri }); },
      });
    },
    logout: providerId => models.logout(providerId),
  };
}

/** Progress of a device-code sign-in, in the shape `registry/provider-setup` takes as `loginState`. */
export type ModelLoginState =
  | { readonly state: 'idle' }
  | { readonly state: 'starting' }
  | { readonly state: 'pending'; readonly userCode: string; readonly verificationUri: string }
  | { readonly state: 'done' }
  | { readonly state: 'failed'; readonly message: string };

/** What the `provider-setup` item shows: the conversation's model, the provider list and the sign-in progress. */
export interface ModelAccessState {
  readonly settings: { readonly provider: string; readonly modelId: string };
  readonly providers: ProviderCatalogEntry[];
  readonly login: ModelLoginState;
}

export interface ModelAccessOptions {
  /** URL prefix the host mounts the routes at. Default `/api/model`. */
  readonly prefix?: string;
  /** How long a sign-in may wait for the person. Default 15 minutes. */
  readonly loginTimeoutMs?: number;
}

/** A Request handler for the model-access routes: it returns `undefined` for any request that is not one of them. */
export type ModelAccessHandler = ((request: Request) => Promise<Response | undefined>) & { state(): Promise<ModelAccessState> };

/**
 * The routes `registry/provider-setup` needs for one native conversation, as a single Request to Response function:
 * - `GET  <prefix>`        `{ settings, providers, login }`; `settings` is the conversation's native model
 * - `PUT  <prefix>`        `{ provider?, modelId?, apiKey? }` saves the key, then `conversation.configure({ model })`
 * - `POST <prefix>/login`  `{ provider }` starts the device-code sign-in; answers when the code is known or the start failed
 * Mount it ahead of your own routes: `const response = await access(request); if (response) return response;`. The model
 * lives only in the conversation's agent configuration; a finished sign-in selects that provider there.
 */
export function createModelAccessHandler(browser: BrowserModels, conversation: Pick<Conversation, 'agent' | 'configure'>, context: Context, options: ModelAccessOptions = {}): ModelAccessHandler {
  const prefix = (options.prefix ?? '/api/model').replace(/\/$/, '');
  let login: ModelLoginState = { state: 'idle' };
  const current = async (): Promise<{ provider: string; modelId: string }> => {
    const model = (await conversation.agent(context)).model;
    return { provider: model?.provider ?? '', modelId: model?.modelId ?? '' };
  };
  const state = async (): Promise<ModelAccessState> => ({ settings: await current(), providers: await browser.catalog(), login });
  const bad = (reason: string, status = 400) => Response.json({ reason }, { status });
  const select = async (model: ModelRef): Promise<void> => { await conversation.configure({ model }, context); };

  function startLogin(provider: string): Promise<void> {
    login = { state: 'starting' };
    return new Promise<void>(shown => {
      browser.loginDeviceCode(provider, { signal: AbortSignal.timeout(options.loginTimeoutMs ?? 15 * 60_000), onCode: code => { login = { state: 'pending', ...code }; shown(); } })
        .then(async () => { login = { state: 'done' }; const modelId = browser.defaultModelId(provider); if (modelId) await select({ provider, modelId }); })
        .catch((error: unknown) => { login = { state: 'failed', message: error instanceof Error ? error.message : String(error) }; })
        .finally(shown); // a sign-in that finished (or failed) without ever showing a code must still answer the request
    });
  }

  /** The JSON body under the package's one request guard (JSON content type, 64 KB cap), or the refusal to answer with. */
  const body = async (request: Request): Promise<{ value: Record<string, unknown> } | { refused: Response }> => {
    try {
      const value = await readJsonBody(request, 64 * 1024, request.signal);
      return value && typeof value === 'object' && !Array.isArray(value) ? { value: value as Record<string, unknown> } : { refused: bad('invalid-body') };
    } catch (error) { return { refused: bad(error instanceof Error ? error.message : 'invalid-body', guardStatus(error)) }; }
  };

  const handler = async (request: Request): Promise<Response | undefined> => {
    const { pathname } = new URL(request.url);
    if (pathname === prefix && request.method === 'GET') return Response.json(await state());
    if (pathname === prefix && request.method === 'PUT') {
      const read = await body(request);
      if ('refused' in read) return read.refused;
      const change = read.value;
      const before = await current();
      const provider = typeof change['provider'] === 'string' ? change['provider'] : before.provider;
      if (!browser.models.getProvider(provider)) return bad('unknown-provider');
      try { if (change['apiKey']) await browser.saveApiKey(provider, String(change['apiKey'])); }
      catch (error) { return bad(error instanceof Error ? error.message : String(error)); }
      // A new provider without a model gets its default model.
      const modelId = typeof change['modelId'] === 'string' && change['modelId'] ? change['modelId'] : provider === before.provider ? before.modelId : browser.defaultModelId(provider) ?? '';
      if (!browser.models.getModel(provider, modelId)) return bad('unknown-model');
      if (provider !== before.provider || modelId !== before.modelId) await select({ provider, modelId });
      return Response.json(await state());
    }
    if (pathname === `${prefix}/login` && request.method === 'POST') {
      const read = await body(request);
      if ('refused' in read) return read.refused;
      const provider = typeof read.value['provider'] === 'string' ? read.value['provider'] : '';
      if (!browser.models.getProvider(provider)?.auth.oauth) return bad('no-sign-in');
      if (login.state !== 'pending' && login.state !== 'starting') await startLogin(provider);
      return Response.json(await state());
    }
    return undefined;
  };
  return Object.assign(handler, { state });
}
