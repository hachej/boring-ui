import { createAssistantMessageEventStream, getCurrentTools, normalizeContext } from '@earendil-works/pi-ai';
import type { AssistantMessage, Message, Models, Tool, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ModelRef } from '@earendil-works/pi-durable';
import { Check } from 'typebox/schema';

/** Virtual model identity persisted by Pi; real requests use the host's Models. */
export const ACTION_PROVIDER = 'boring-action';
const PREFIX = 'boring_action_';

export interface StructuredAction {
  readonly model: ModelRef;
  readonly extraction: { readonly model: ModelRef; readonly instructions: string; readonly tool: Tool };
  /** Host decision policy (Jev, another classifier, or deterministic rules). Literal true admits extraction. */
  readonly decide: (input: { readonly message: string; readonly history: readonly Message[]; readonly signal: AbortSignal }) => Promise<boolean>;
  readonly reply: string;
  /** Host-localized text for an outcome that must not be retried automatically. */
  readonly uncertainReply: string;
  /** Only return true for a known atomic rejection with no effect. */
  readonly rejectedWithoutEffect?: (result: ToolResultMessage) => boolean;
  readonly decisionTimeoutMs?: number;
  readonly maxInputCharacters?: number;
}

export interface ActionModelsOptions {
  /** Resolve trusted configuration; this never registers tools or grants permissions. */
  readonly resolve: (id: string) => StructuredAction | undefined;
  readonly now?: () => number;
}

const zeroUsage = (): AssistantMessage['usage'] => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const inputText = (content: Message['content']): string => typeof content === 'string' ? content : content.filter(p => p.type === 'text').map(p => p.text).join('');

/** Substitute actual scalar results only. Missing values cannot become invented confirmations. */
export function actionReply(template: string, result: unknown): string {
  return template.replace(/\{([\w.]+)\}/g, (_match: string, path: string) => {
    let value: unknown = result;
    for (const key of path.split('.')) {
      value = value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
    }
    if (Array.isArray(value) && value.every(v => typeof v === 'string')) value = value.join('\n');
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error(`Missing action result: ${path}`);
    return String(value);
  });
}

async function admitted(action: StructuredAction, message: string, history: Message[], parent?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  if (signal.aborted) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const cancelled = new Promise<false>(resolve => {
    onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => controller.abort(), action.decisionTimeoutMs ?? 400);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => action.decide({ message, history, signal })).then(value => value === true, () => false), cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/** Compose at HarnessOptions.models, outside the host's admitted/metered real Models.
 * Pi still owns generation, tool execution, hooks, history and recovery. Tool-free requests
 * (including native compaction) delegate to the full model. No tool is executed here.
 */
export function withActionModels<T extends Models>(models: T, options: ActionModelsOptions): T {
  const now = options.now ?? Date.now;
  const required = (ref: ModelRef) => {
    const model = models.getModel(ref.provider, ref.modelId);
    if (!model || model.provider === ACTION_PROVIDER) throw new Error(`Unavailable action model: ${ref.provider}/${ref.modelId}`);
    return model;
  };
  const resolve = (id: string) => {
    const action = options.resolve(id);
    if (!action) throw new Error(`No action agent ${id}`);
    return action;
  };
  const wrapped: Pick<Models, 'getModel' | 'streamSimple' | 'completeSimple' | 'stream' | 'complete' | 'streamDeferred' | 'fetchDeferred' | 'cancelDeferred'> = {
    getModel(provider, id) {
      if (provider !== ACTION_PROVIDER) return models.getModel(provider, id);
      const action = options.resolve(id);
      const model = action && models.getModel(action.model.provider, action.model.modelId);
      return model && model.provider !== ACTION_PROVIDER ? { ...model, provider, id } : undefined;
    },
    streamSimple(model, context, requestOptions) {
      if (model.provider !== ACTION_PROVIDER) return models.streamSimple(model, context, requestOptions);
      const action = resolve(model.id);
      const original = required(action.model);
      const out = createAssistantMessageEventStream();
      const full = async () => { for await (const event of models.streamSimple(original, context, requestOptions)) out.push(event); };
      const emit = (message: AssistantMessage) => {
        if (message.stopReason === 'error' || message.stopReason === 'aborted') out.push({ type: 'error', reason: message.stopReason, error: message });
        else if (message.stopReason !== 'pending') out.push({ type: 'done', reason: message.stopReason, message });
        else throw new Error('An action cannot emit a pending completion');
      };
      void (async () => {
        const messages = context.messages.filter(message => message.role !== 'system');
        const last = messages.at(-1), previous = messages.at(-2);
        const calls = previous?.role === 'assistant' ? previous.content.filter(p => p.type === 'toolCall') : [];
        const call = calls.length === 1 ? calls[0] : undefined;
        if (last?.role === 'toolResult' && call?.id === last.toolCallId && call.name === action.extraction.tool.name && call.id.startsWith(PREFIX)) {
          if (last.isError) {
            let rejected = false;
            try { rejected = action.rejectedWithoutEffect?.(last) === true; } catch { /* Unknown outcomes remain uncertain. */ }
            if (rejected) return full();
          }
          let text = action.uncertainReply;
          if (!last.isError) {
            try { text = actionReply(action.reply, JSON.parse(inputText(last.content))); } catch { /* A possible effect must not be repeated. */ }
          }
          emit({ role: 'assistant', content: [{ type: 'text', text }], api: original.api, provider: ACTION_PROVIDER, model: model.id, usage: zeroUsage(), stopReason: 'stop', timestamp: now() });
          return;
        }
        const tool = getCurrentTools(normalizeContext(context).messages).find(tool => tool.name === action.extraction.tool.name);
        if (!tool || last?.role !== 'user' || requestOptions?.signal?.aborted || requestOptions?.deferred) return full();
        const raw = inputText(last.content);
        if (!raw.trim() || raw.length > (action.maxInputCharacters ?? 1500) || (Array.isArray(last.content) && last.content.some(p => p.type !== 'text'))) return full();
        if (!await admitted(action, raw, messages.slice(0, -1), requestOptions?.signal) || requestOptions?.signal?.aborted) return full();
        let extracted: AssistantMessage;
        try {
          extracted = await models.streamSimple(required(action.extraction.model), {
            systemPrompt: action.extraction.instructions, messages: [last], tools: [action.extraction.tool],
          }, requestOptions).result();
          const extractedCalls = extracted.content.filter(p => p.type === 'toolCall');
          const extractedCall = extractedCalls.length === 1 ? extractedCalls[0] : undefined;
          if (extracted.stopReason !== 'toolUse' || !extractedCall || extractedCall.name !== tool.name ||
              !Check(action.extraction.tool.parameters, extractedCall.arguments) || !Check(tool.parameters, extractedCall.arguments)) return full();
          // Native ToolTask owns the write, permission checks and host receipt; keep this ID in its transcript.
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          const id = PREFIX + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
          emit({ ...extracted, content: [{ ...extractedCall, id }] });
        } catch { return full(); }
      })().catch(error => emit({ role: 'assistant', content: [], api: original.api, provider: original.provider, model: original.id, usage: zeroUsage(), stopReason: 'error', errorMessage: String(error instanceof Error ? error.message : error), timestamp: now() })).finally(() => out.end());
      return out;
    },
    stream(model, context, requestOptions) {
      return models.stream(model.provider === ACTION_PROVIDER ? required(resolve(model.id).model) : model, context, requestOptions);
    },
    completeSimple: (model, context, requestOptions) => wrapped.streamSimple(model, context, requestOptions).result(),
    complete: (model, context, requestOptions) => wrapped.stream(model, context, requestOptions).result(),
    streamDeferred(model, handle, requestOptions) {
      return models.streamDeferred(model.provider === ACTION_PROVIDER ? required(resolve(model.id).model) : model, handle, requestOptions);
    },
    fetchDeferred: (model, handle, requestOptions) => wrapped.streamDeferred(model, handle, requestOptions).result(),
    cancelDeferred(model, handle, requestOptions) {
      return models.cancelDeferred(model.provider === ACTION_PROVIDER ? required(resolve(model.id).model) : model, handle, requestOptions);
    },
  };
  return new Proxy(models, { get(target, key) {
    if (Object.hasOwn(wrapped, key)) return Reflect.get(wrapped, key);
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
