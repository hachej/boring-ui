// Per-request prompt context as one ordinary native pi-durable extension. Extension point: `GenerationHooks.beforeRequest`,
// registered with `hook(GenerationTask, ...)`. Pi runs it before every request attempt (retries and crash recovery included)
// and uses its result for that request only, so the text is recomputed each time and never appended to the transcript.
// The host owns the data: `context` reads its own request-scoped state keyed by the conversation (Pi's hook context carries no
// caller values). Placement: one user-role `<request-context>` message immediately before the round's final user message, so
// system messages and everything earlier stay byte-identical. Failure is fail-open: a throw is reported and the request goes
// out without the context; an aborted turn rethrows. Advisory only: never use it for policy or authorization.
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
  /** Receives a failed `context` call (default: the Harness reporter, `HarnessOptions.onReport`). */
  readonly onError?: (error: unknown) => void;
}

/** The Harness reporter is on the runtime object Pi passes to hooks (`TaskRuntime.report`); the hook type does not declare it. */
type Reporting = { readonly report?: (error: unknown) => void };

export function createPromptContext(options: PromptContextOptions): Extension {
  const tag = options.tag ?? 'request-context';
  return defineExtension({
    name: options.name ?? 'host.prompt-context',
    hooks: [hook(GenerationTask, {
      beforeRequest: async (request, api: HookApi, context) => {
        let text: string | undefined;
        try {
          text = await options.context({ conversationId: api.conversationId, messages: request.messages, signal: context.abortSignal });
        } catch (error) {
          if (context.abortSignal?.aborted) throw error;
          const report = (api as HookApi & Reporting).report;
          if (options.onError) options.onError(error);
          else report?.(error);
          return undefined;
        }
        if (!text) return undefined;
        const message: Message = { role: 'user', content: [{ type: 'text', text: `<${tag}>\n${text}\n</${tag}>` }], timestamp: Date.now() };
        // Before the round's final user message; a request without one gets it at the end.
        const last = request.messages.findLastIndex(item => item.role === 'user');
        const at = last < 0 ? request.messages.length : last;
        return { messages: [...request.messages.slice(0, at), message, ...request.messages.slice(at)] };
      },
    })],
  });
}
