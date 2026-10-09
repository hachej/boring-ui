// @hachej/boring-agent/model-gateway: the host's model gateway. Browser-side Pi agents (`@hachej/boring-agent/gateway-provider`) call models
// through it with the person's app session; the provider key never leaves the server. Server-only by role (it holds the key),
// Fetch-only by construction (no node or Pi imports, ARCHITECTURE.json pathRules), so it runs in Node, Workers or a shared
// "Boring model gateway" service with the same API: the browser knows only a base URL.
//
// API under `basePath`: `POST /v1/chat/completions` (OpenAI-compatible, JSON or SSE streaming, passed through as the upstream
// sends it) and `GET /v1/models` (the allowed ids). The host owns the policy: who may call (`authorize`, the app session), which
// models (`allow`, gateway id -> upstream id), how much (`budget`), which upstream and key (`upstream`). The browser cannot choose
// an upstream, a key or a header: the forwarded body is rebuilt from an allowlist of fields and no request header is forwarded.
// Errors are `{ error: { code, message } }`: 401 no session, 403 model not allowed, 429 budget, 502 upstream failure (never the
// upstream's body, which may quote the key), 400/404/405/413 for malformed calls. `log` receives metadata only (person, model,
// status, tokens, latency), never prompts or completions. The body goes through the shared request guard (JSON content type,
// byte cap), like every other handler of the packages.
import { RequestGuardError, readJsonBody } from '@hachej/boring-files/request-guard';

/** An upstream speaking OpenAI chat completions. The gateway gives it a rebuilt body; the upstream adds its own credential. */
export interface ModelUpstream {
  readonly id: string;
  /** The upstream's name for the output ceiling (`max_completion_tokens` for OpenAI, `max_tokens` for most compatible APIs). */
  readonly maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  readonly chatCompletions: (body: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<Response>;
}

export type BudgetDecision =
  | { readonly kind: 'admitted'; readonly maxTokens: number }
  | { readonly kind: 'refused'; readonly retryAfterSeconds: number; readonly message: string };

/** Per-person spending policy. `admit` runs once per completion request, before the upstream is called. */
export interface ModelBudget {
  readonly admit: (person: string, request: { readonly model: string; readonly maxTokens: number | undefined }) => BudgetDecision | Promise<BudgetDecision>;
}

export interface GatewayLogEntry {
  readonly person: string | null;
  readonly model: string | null;
  readonly status: number;
  readonly code?: string;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ModelGatewayOptions {
  readonly upstream: ModelUpstream;
  /** Allowed gateway model ids; a record maps each to its upstream model id. */
  readonly allow: readonly string[] | Readonly<Record<string, string>>;
  readonly budget: ModelBudget;
  /** The app session: the person's stable id, or nothing (401). Only this callback ever sees the request headers. */
  readonly authorize: (request: Request) => string | null | undefined | Promise<string | null | undefined>;
  readonly log?: (entry: GatewayLogEntry) => void;
  /** Where the gateway is mounted, for example `/api/llm`. Default: the root. */
  readonly basePath?: string;
  readonly maxBodyBytes?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
/** Anthropic's OpenAI-compatible endpoint. */
export const ANTHROPIC_OPENAI_BASE_URL = 'https://api.anthropic.com/v1';

/** Body fields a caller may set; everything else (store, user, metadata, n, provider routing...) is dropped. */
const FORWARDED = ['messages', 'temperature', 'top_p', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'stop', 'seed', 'presence_penalty', 'frequency_penalty'] as const;

const failure = (status: number, code: string, message: string, headers: Record<string, string> = {}): Response =>
  Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store', ...headers } });

export interface OpenAICompatibleUpstreamOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  readonly fetch?: typeof globalThis.fetch;
}

/** An OpenAI-compatible upstream at a fixed base URL with the server's key. */
export function openAICompatibleUpstream(options: OpenAICompatibleUpstreamOptions): ModelUpstream {
  if (!options.apiKey) throw new TypeError('openAICompatibleUpstream needs the server-side apiKey');
  const base = (options.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const apiKey = options.apiKey;
  return Object.freeze({
    id: options.id ?? 'openai', maxTokensField: options.maxTokensField ?? 'max_completion_tokens',
    chatCompletions: (body: Readonly<Record<string, unknown>>, signal: AbortSignal) => fetchImpl(`${base}/chat/completions`, {
      method: 'POST', signal, body: JSON.stringify(body),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: body.stream === true ? 'text/event-stream' : 'application/json' },
    }),
  });
}

/** Anthropic through its OpenAI-compatible endpoint. */
export const anthropicUpstream = (options: Omit<OpenAICompatibleUpstreamOptions, 'baseUrl' | 'maxTokensField'>): ModelUpstream =>
  openAICompatibleUpstream({ id: 'anthropic', ...options, baseUrl: ANTHROPIC_OPENAI_BASE_URL, maxTokensField: 'max_tokens' });

/** A scripted turn that calls tools instead of answering in text. */
export interface ScriptedToolCalls {
  readonly toolCalls: readonly { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }[];
}

export interface ScriptedUpstreamOptions {
  /** The deterministic reply to the conversation (OpenAI-shaped messages): text, or tool calls when the request declared tools. */
  readonly reply: (messages: readonly Readonly<Record<string, unknown>>[], request: { readonly tools: readonly string[] }) => string | ScriptedToolCalls;
  readonly id?: string;
}

const tokensOf = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

/** The function names the request declared (`tools[].function.name`). */
const declaredTools = (tools: unknown): string[] => Array.isArray(tools)
  ? tools.flatMap(tool => { const name = (tool as { function?: { name?: unknown } } | null)?.function?.name; return typeof name === 'string' ? [name] : []; }) : [];

/** A keyless upstream answering every request locally with `reply`, in the OpenAI wire format (JSON or SSE), tool calls included. */
export function scriptedUpstream(options: ScriptedUpstreamOptions): ModelUpstream {
  const encoder = new TextEncoder();
  let counter = 0;
  return Object.freeze({
    id: options.id ?? 'scripted', maxTokensField: 'max_completion_tokens',
    chatCompletions: async (body: Readonly<Record<string, unknown>>) => {
      const messages = Array.isArray(body.messages) ? (body.messages as Readonly<Record<string, unknown>>[]) : [];
      const tools = declaredTools(body.tools);
      const replied = options.reply(messages, { tools });
      const calls = typeof replied === 'string' ? [] : replied.toolCalls.filter(call => tools.includes(call.name))
        .map((call, index) => ({ index, id: `call_scripted_${counter + 1}_${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
      const text = typeof replied === 'string' ? replied : calls.length ? '' : '(scripted) no declared tool to call.';
      const finish = calls.length ? 'tool_calls' : 'stop';
      const id = `chatcmpl-scripted-${++counter}`, created = 0, model = String(body.model);
      const usage = { prompt_tokens: tokensOf(JSON.stringify(messages)), completion_tokens: tokensOf(text + JSON.stringify(calls)), total_tokens: 0 };
      const usageTotal = { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens };
      if (body.stream !== true) {
        const message = calls.length ? { role: 'assistant', content: null, tool_calls: calls.map(({ index: _index, ...call }) => call) } : { role: 'assistant', content: text };
        return Response.json({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message, finish_reason: finish }], usage: usageTotal });
      }
      const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices, ...extra })}\n\n`;
      const frames = [
        chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]),
        ...(text.match(/\S+\s*/g) ?? []).map(piece => chunk([{ index: 0, delta: { content: piece }, finish_reason: null }])),
        ...calls.map(call => chunk([{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }])),
        chunk([{ index: 0, delta: {}, finish_reason: finish }]),
        chunk([], { usage: usageTotal }),
        'data: [DONE]\n\n',
      ];
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const frame of frames) controller.enqueue(encoder.encode(frame)); controller.close(); } }),
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    },
  });
}

export interface MemoryBudgetOptions {
  readonly requestsPerMinute: number;
  readonly maxTokensPerRequest: number;
  readonly now?: () => number;
}

/** In-memory budget for one process: a sliding one-minute request window per person and a per-request output ceiling
 * (a larger or missing request is clamped to it). A shared gateway swaps in a durable implementation of `ModelBudget`. */
export function memoryBudget(options: MemoryBudgetOptions): ModelBudget {
  const now = options.now ?? Date.now;
  const windows = new Map<string, number[]>();
  return Object.freeze({
    admit: (person: string, request: { readonly maxTokens: number | undefined }): BudgetDecision => {
      const at = now();
      const recent = (windows.get(person) ?? []).filter(time => time > at - 60_000);
      if (recent.length >= options.requestsPerMinute) {
        windows.set(person, recent);
        return { kind: 'refused', retryAfterSeconds: Math.max(1, Math.ceil(((recent[0] ?? at) + 60_000 - at) / 1000)), message: `At most ${options.requestsPerMinute} model requests a minute; try again shortly.` };
      }
      recent.push(at);
      windows.set(person, recent);
      const asked = request.maxTokens;
      return { kind: 'admitted', maxTokens: asked !== undefined && asked > 0 ? Math.min(asked, options.maxTokensPerRequest) : options.maxTokensPerRequest };
    },
  });
}

interface Usage { inputTokens?: number; outputTokens?: number }
function usageOf(value: unknown, into: Usage): void {
  const usage = (value as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null } | null)?.usage;
  if (typeof usage?.prompt_tokens === 'number') into.inputTokens = usage.prompt_tokens;
  if (typeof usage?.completion_tokens === 'number') into.outputTokens = usage.completion_tokens;
}

/** The gateway as a Fetch handler: `(request) => Promise<Response>`. */
export function createModelGateway(options: ModelGatewayOptions): (request: Request) => Promise<Response> {
  if (!options.upstream || typeof options.upstream.chatCompletions !== 'function') throw new TypeError('createModelGateway needs an upstream');
  if (typeof options.authorize !== 'function') throw new TypeError('createModelGateway needs authorize(request)');
  if (!options.budget || typeof options.budget.admit !== 'function') throw new TypeError('createModelGateway needs a budget');
  const allowed = new Map<string, string>(Array.isArray(options.allow) ? options.allow.map(id => [id, id] as const) : Object.entries(options.allow));
  const basePath = (options.basePath ?? '').replace(/\/+$/, '');
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const now = options.now ?? Date.now;
  const upstream = options.upstream;
  const report = (entry: GatewayLogEntry) => { try { options.log?.(entry); } catch { /* logging never fails a request */ } };

  async function completions(request: Request, person: string, started: number): Promise<Response> {
    const done = (status: number, model: string | null, code: string, response: Response) => { report({ person, model, status, code, latencyMs: now() - started }); return response; };
    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonBody(request, maxBodyBytes, request.signal);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestGuardError(400, 'not an object');
      body = parsed as Record<string, unknown>;
    } catch (error) {
      const status = error instanceof RequestGuardError ? error.status : 400;
      return status === 413 ? done(413, null, 'too-large', failure(413, 'too-large', 'The request is too large.'))
        : status === 415 ? done(415, null, 'unsupported-media-type', failure(415, 'unsupported-media-type', 'Send the request as application/json.'))
          : done(400, null, 'invalid', failure(400, 'invalid', 'The body must be a JSON chat completion request.'));
    }
    const model = typeof body.model === 'string' ? body.model : null;
    if (!model || !Array.isArray(body.messages) || body.messages.length === 0) return done(400, model, 'invalid', failure(400, 'invalid', 'A model and at least one message are required.'));
    const upstreamModel = allowed.get(model);
    if (upstreamModel === undefined) return done(403, model, 'model-not-allowed', failure(403, 'model-not-allowed', `The model "${model.slice(0, 80)}" is not available here.`));
    const asked = [body.max_completion_tokens, body.max_tokens].find((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const decision = await options.budget.admit(person, { model, maxTokens: asked });
    if (decision.kind === 'refused') return done(429, model, 'budget', failure(429, 'budget', decision.message, { 'retry-after': String(decision.retryAfterSeconds) }));

    // Rebuilt, never forwarded: the model is the host's mapping, the ceiling the budget's, and only listed fields pass.
    const stream = body.stream === true;
    const forwarded: Record<string, unknown> = { model: upstreamModel, stream, [upstream.maxTokensField ?? 'max_completion_tokens']: decision.maxTokens };
    for (const field of FORWARDED) if (body[field] !== undefined) forwarded[field] = body[field];
    if (stream) forwarded.stream_options = { include_usage: true };

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    let answer: Response;
    try { answer = await upstream.chatCompletions(forwarded, signal); } catch {
      return done(502, model, 'upstream-unreachable', failure(502, 'upstream-unreachable', 'The model provider could not be reached.'));
    }
    if (!answer.ok || !answer.body) {
      await answer.body?.cancel().catch(() => undefined);
      return done(502, model, 'upstream-failed', failure(502, 'upstream-failed', `The model provider refused the request (${answer.status}).`));
    }
    const usage: Usage = {};
    const finish = (status: number, code?: string) => report({ person, model, status, ...(code ? { code } : {}), latencyMs: now() - started, ...usage });
    if (!stream) {
      let json: unknown;
      try { json = await answer.json(); } catch { return done(502, model, 'upstream-failed', failure(502, 'upstream-failed', 'The model provider sent an unreadable answer.')); }
      usageOf(json, usage);
      finish(200);
      return Response.json(json, { headers: { 'cache-control': 'no-store' } });
    }
    // SSE passthrough, byte for byte; the `usage` frame is read on the way for the log, nothing else is looked at.
    const reader = answer.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const scan = (text: string) => {
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.startsWith('data:') && line.includes('"usage"')) { try { usageOf(JSON.parse(line.slice(5)), usage); } catch { /* not JSON */ } }
    };
    let ended = false;
    const end = (status: number, code?: string) => { if (!ended) { ended = true; finish(status, code); } };
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done: finished, value } = await reader.read();
          if (finished) { scan('\n'); end(200); controller.close(); return; }
          scan(decoder.decode(value, { stream: true }));
          controller.enqueue(value);
        } catch {
          end(502, 'upstream-interrupted');
          controller.error(new Error('The model provider stream was interrupted.'));
        }
      },
      async cancel() { end(499, 'client-closed'); await reader.cancel().catch(() => undefined); },
    }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  }

  return async (request: Request): Promise<Response> => {
    const started = now();
    const path = new URL(request.url).pathname;
    const route = path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : null;
    if (route !== '/v1/chat/completions' && route !== '/v1/models') return failure(404, 'not-found', 'Unknown model gateway route.');
    const method = route === '/v1/models' ? 'GET' : 'POST';
    if (request.method !== method) return failure(405, 'method-not-allowed', `Use ${method}.`, { allow: method });
    const person = await options.authorize(request);
    if (!person) { report({ person: null, model: null, status: 401, code: 'unauthenticated', latencyMs: now() - started }); return failure(401, 'unauthenticated', 'Sign in to use models.'); }
    if (route === '/v1/models') return Response.json({ object: 'list', data: [...allowed.keys()].map(id => ({ id, object: 'model', owned_by: 'boring-gateway' })) }, { headers: { 'cache-control': 'no-store' } });
    return completions(request, person, started);
  };
}
