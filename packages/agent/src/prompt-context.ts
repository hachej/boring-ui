// Per-request prompt context as one ordinary native pi-durable extension. Extension point: `GenerationHooks.beforeRequest`,
// registered with `hook(GenerationTask, ...)`. Pi runs it before every request attempt (retries and crash recovery included)
// and uses its result for that request only, so the text is recomputed each time and never appended to the transcript.
// The host owns the data: `context` reads its own request-scoped state keyed by the conversation (Pi's hook context carries no
// caller values). Failure is Pi's: Pi's `hooks.each` reports a throw through `HarnessOptions.onReport`, continues the request
// without this hook's result, and rethrows only when the turn is aborted (scheduler.js, `hooks.each`). Advisory only: never use
// it for policy or authorization.
import { GenerationTask, defineExtension, hook } from '@earendil-works/pi-durable';
import type { ConversationId, Extension, HookApi } from '@earendil-works/pi-durable';
import type { Message } from '@earendil-works/pi-ai';

export interface PromptContextInput {
  readonly conversationId: ConversationId;
  /** The request's messages as Pi would send them (read-only). */
  readonly messages: readonly Message[];
  /** The task's abort signal, when there is one. */
  readonly signal: AbortSignal | undefined;
}

export interface PromptContextOptions {
  /** Extension name (default `host.prompt-context`). Install one extension per independent context; they compose in install order. */
  readonly name?: string;
  /** Wrapper tag of the message (default `request-context`). */
  readonly tag?: string;
  /** Fresh text for this request attempt; `undefined` or `''` adds no message. */
  readonly context: (input: PromptContextInput) => string | undefined | Promise<string | undefined>;
}

/** Messages made by this module, so a later extension skips them when it looks for the round's question (install order holds). */
const produced = new WeakSet<Message>();

/**
 * The request messages with one user message carrying `text` added. It goes right before the round's question (the last message
 * that is not a context from an earlier extension) when that is a user message; otherwise (after tool results, or after an
 * assistant continuation) at the tail. Pure: the input array is not changed.
 */
export function withRequestContext(messages: readonly Message[], text: string, tag = 'request-context'): Message[] {
  // The text may be browser-supplied: neutralise every opening or closing `tag` in it (any case, spaces allowed) so it cannot end the wrapper.
  const inner = text.replace(new RegExp(`<(\\s*/?\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`, 'gi'), '<\\$1');
  const message: Message = { role: 'user', content: [{ type: 'text', text: `<${tag}>\n${inner}\n</${tag}>` }], timestamp: Date.now() };
  produced.add(message);
  let end = messages.length;
  while (end > 0 && produced.has(messages[end - 1]!)) end--;
  const question = messages[end - 1];
  const at = question?.role === 'user' ? end - 1 : messages.length;
  return [...messages.slice(0, at), message, ...messages.slice(at)];
}

export function createPromptContext(options: PromptContextOptions): Extension {
  return defineExtension({
    name: options.name ?? 'host.prompt-context',
    hooks: [hook(GenerationTask, {
      beforeRequest: async (request, api: HookApi, context) => {
        const text = await options.context({ conversationId: api.conversationId, messages: request.messages, signal: context.abortSignal });
        if (!text) return undefined;
        return { messages: withRequestContext(request.messages, text, options.tag) };
      },
    })],
  });
}

const ROLES = {
  docked: 'The chat is docked beside the page: you lead. Open the pages, records and files that answer the question in the viewer, and say what you opened.',
  floating: 'The chat floats over the page: the person leads. Do not move the page unless asked; answer briefly about what is on screen and suggest where to go.',
} as const;

/**
 * The text for the browser's request context: the screen's `{ name, params }` with `placement` beside them, as `useRemoteChat` sends it
 * (an older client sends only `{ name, params }`, which still renders; a `{ screen }` wrapper is read too). The host calls this in
 * `createPromptContext({ context })` on the value it stored by conversation id. `placement` is `docked` or `floating` and picks the
 * agent's role. Both are advisory text from the browser: placement changes behaviour and never authority (a docked agent writes no
 * more than a floating one), and anything else in the value is ignored.
 * See docs/architecture/PAGE-TOOLS.md (PLACE-1..3).
 */
export function renderRequestContext(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { placement, screen } = value as { placement?: unknown; screen?: unknown };
  const lines: string[] = [];
  if (placement === 'docked' || placement === 'floating') lines.push(`Placement: ${placement}. ${ROLES[placement]}`);
  const shown = typeof screen === 'object' && screen !== null ? screen : value;
  if (typeof (shown as { name?: unknown }).name === 'string') {
    const { name, params } = shown as { name: string; params?: unknown };
    lines.push(`The person is looking at: ${name}${params && typeof params === 'object' && Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''}`);
  }
  return lines.length ? lines.join('\n') : undefined;
}
