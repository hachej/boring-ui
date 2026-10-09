import { defineDoc } from '@earendil-works/pi-durable';
import type { Conversation, ConversationId, ConversationView, EntryRecord, Harness, SettledSubmissionRecord } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { withAbortSignal } from '@earendil-works/chord/context';
import { ASK_USER_TOOL, answerUserQuestion, askUserQuestionId } from '@hachej/boring-agent/ask-user';

/**
 * External messaging channels (WhatsApp, Telegram, Slack, SMS…) for a native durable conversation.
 *
 * A channel is an edge: it verifies the provider's webhook, parses messages and sends replies. Everything else stays
 * native: a message becomes `Conversation.submit` with the provider message ID as `requestId` (Pi deduplicates and
 * queues a busy conversation's input), and the reply is the submission's settled `answer` entry. The web chat watches
 * the same conversation, so a WhatsApp thread and the browser are two views of one session.
 */
export const CHANNELS = Object.freeze({ schema: 'boring.channels', version: 1, maxOutbox: 1000, maxText: 16_384 });

/** One verified inbound message, already reduced to text. */
export interface ChannelMessage {
  /** Adapter ID, e.g. `whatsapp`. */
  readonly channel: string;
  /** Provider-stable sender (thread) address: where replies go, e.g. the WhatsApp user ID. */
  readonly address: string;
  /** Provider message ID, stable across webhook redelivery. */
  readonly messageId: string;
  readonly text: string;
  readonly receivedAt: number;
}

/** What the gateway asks an adapter to deliver. `markdown` is the agent's text; the adapter renders and splits it. */
export type ChannelReply =
  | { readonly kind: 'answer'; readonly markdown: string }
  | { readonly kind: 'question'; /** Assistant-entry-bound question ID. */ readonly callId: string; readonly prompt: string; readonly options: readonly string[]; readonly allowFreeText: boolean }
  | { readonly kind: 'notice'; readonly text: string };

/** The result of reading one webhook request. */
export type ChannelReceipt =
  /** Verified messages. The gateway acknowledges the request once each is durably admitted. */
  | { readonly kind: 'messages'; readonly messages: readonly ChannelMessage[] }
  /** Answer the request directly: a verification handshake, a refused signature, an oversized body… */
  | { readonly kind: 'response'; readonly response: Response };

/**
 * The universal channel contract. Trusted host code: it holds the provider credentials, never the conversation.
 * Function properties, not methods, so implementations are checked contravariantly.
 */
export interface ChannelAdapter {
  readonly id: string;
  /** Verify and parse a webhook request. Unverified input must return a `response`, never messages. */
  readonly receive: (request: Request) => Promise<ChannelReceipt>;
  /** Deliver one reply to `address`. Throw `{ retryable: true }` (or a network error) for a transient failure. */
  readonly send: (address: string, reply: ChannelReply) => Promise<void>;
  /** Optional receipt feedback after admission, such as a read mark and typing indicator. Failures are ignored. */
  readonly received?: (message: ChannelMessage) => Promise<void>;
}

/** Trusted host policy: the conversation this sender talks to, or null to refuse. The address is not an identity proof
 * beyond what the adapter verified; the host owns allow-lists, agents and conversation creation. */
export type ChannelRoute = (message: ChannelMessage) => Promise<Conversation | null>;

export interface ChannelGatewayOptions {
  readonly harness: Harness;
  readonly context: Context;
  readonly adapters: readonly ChannelAdapter[];
  readonly route: ChannelRoute;
  /** Delays between send attempts; the last failure is reported and the reply dropped. */
  readonly retryDelaysMs?: readonly number[];
  /** Observe refusals and failures. Messages carry no secrets; message text is not included. */
  readonly onEvent?: (event: ChannelEvent) => void;
}

export type ChannelEvent =
  | { readonly kind: 'refused'; readonly channel: string; readonly messageId: string }
  | { readonly kind: 'duplicate'; readonly channel: string; readonly messageId: string }
  | { readonly kind: 'answered-question'; readonly channel: string; readonly callId: string }
  | { readonly kind: 'delivered'; readonly channel: string; readonly requestId: string; readonly reply: ChannelReply['kind'] }
  | { readonly kind: 'undeliverable'; readonly channel: string; readonly requestId: string; readonly reason: string };

export interface ChannelGateway {
  /** The Fetch handler for one adapter's webhook. */
  readonly handler: (channel: string) => (request: Request) => Promise<Response>;
  /** Resume delivery of every reply admitted before a restart. Call once after `harness.resume()`. */
  readonly start: () => Promise<void>;
  /** Stop waiting and watching. Admitted work and undelivered replies stay durable for the next `start`. */
  readonly close: () => Promise<void>;
}

/** A pending channel reply: written before the input is submitted, removed after the reply is sent. */
type OutboxItem = {
  requestId: string; conversationId: ConversationId; channel: string; address: string; text: string;
  /** `ask_user` calls already sent to this address while this input's run was active. */
  asked: string[];
};
/** Detach a document draft before its commit settles. */
const copy = (item: OutboxItem): OutboxItem => ({ ...item, asked: [...item.asked] });
/** Owed replies, and the newest message IDs that answered a question (so a redelivered answer is not a new prompt). */
const Outbox = defineDoc<{ items: OutboxItem[]; answers: string[] }>({ kind: 'boring.channels.outbox', version: 1, scope: 'session', initial: () => ({ items: [], answers: [] }) });
const MAX_ANSWERS = 500;

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reply = (status: number, body: Record<string, unknown>): Response => Response.json({ schema: CHANNELS.schema, version: CHANNELS.version, ...body }, { status, headers });

/** The native request ID of a channel message. Pi deduplicates inputs on it per conversation. */
export const channelRequestId = (message: Pick<ChannelMessage, 'channel' | 'messageId'>): string => `channel:${message.channel}:${message.messageId}`;

export interface PendingQuestion { /** Assistant-entry-bound question ID. */ readonly callId: string; readonly prompt: string; readonly options: readonly string[]; readonly allowFreeText: boolean }

/** `ask_user` calls of the active transcript that have no tool result yet, oldest first. */
export function pendingQuestions(entries: readonly EntryRecord[]): PendingQuestion[] {
  const pending = new Map<string, PendingQuestion>();
  for (const entry of entries) for (const message of entry.model ?? []) {
    if (message.role === 'toolResult') pending.delete(message.toolCallId);
    if (message.role !== 'assistant') continue;
    for (const part of message.content) {
      if (part.type !== 'toolCall' || part.name !== ASK_USER_TOOL) continue;
      const args = part.arguments as { question?: unknown; options?: unknown; allowFreeText?: unknown };
      if (typeof args.question !== 'string') continue;
      const options = Array.isArray(args.options) ? args.options.filter((option): option is string => typeof option === 'string') : [];
      pending.set(part.id, { callId: askUserQuestionId(entry.id, part.id), prompt: args.question, options, allowFreeText: args.allowFreeText === true });
    }
  }
  return [...pending.values()];
}

/** A typed reply to a question: an exact option, its 1-based number, or free text. */
export function questionAnswer(question: PendingQuestion, text: string): string {
  const trimmed = text.trim();
  const exact = question.options.find(option => option.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const index = /^\d{1,2}$/.test(trimmed) ? Number(trimmed) - 1 : -1;
  return index >= 0 && index < question.options.length ? question.options[index]! : trimmed;
}

/** The visible text of the assistant message that answered a submission. */
function answerText(entry: EntryRecord | undefined): string {
  return (entry?.model ?? []).flatMap(message => message.role === 'assistant' ? message.content : [])
    .flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n').trim();
}

function settledReply(record: SettledSubmissionRecord, entry: EntryRecord | undefined): ChannelReply {
  if (record.status === 'done') {
    const markdown = answerText(entry);
    return markdown ? { kind: 'answer', markdown } : { kind: 'notice', text: 'Done.' };
  }
  return { kind: 'notice', text: record.reason === 'aborted' ? 'The request was stopped before an answer.' : 'The agent could not answer this message.' };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Connect channel adapters to native conversations. It adds no queue, scheduler or second session store: Pi admits,
 * deduplicates and orders the input; the only durable addition is the session document of replies still owed.
 * Delivery is at least once: a crash between sending and recording repeats that reply.
 */
export function createChannelGateway(options: ChannelGatewayOptions): ChannelGateway {
  const { harness, route } = options;
  const adapters = new Map(options.adapters.map(adapter => [adapter.id, adapter]));
  if (adapters.size !== options.adapters.length) throw new Error('Channel adapter IDs must be unique');
  const retryDelays = options.retryDelaysMs ?? [1000, 4000, 15_000, 60_000];
  const emit = (event: ChannelEvent) => { try { options.onEvent?.(event); } catch { /* observers never break delivery */ } };
  const closing = new AbortController();
  const context = withAbortSignal(closing.signal, options.context);
  const delivering = new Map<string, Promise<void>>();
  const watchers = new Map<string, { readonly run: Promise<void>; readonly stop: () => void }>();
  const pendingConversation = new Map<string, string>();

  async function send(item: Pick<OutboxItem, 'channel' | 'address' | 'requestId'>, message: ChannelReply): Promise<boolean> {
    const adapter = adapters.get(item.channel);
    if (!adapter) { emit({ kind: 'undeliverable', channel: item.channel, requestId: item.requestId, reason: 'unknown-channel' }); return false; }
    for (let attempt = 0; ; attempt += 1) {
      try { await adapter.send(item.address, message); emit({ kind: 'delivered', channel: item.channel, requestId: item.requestId, reply: message.kind }); return true; }
      catch (error) {
        const retryable = (error as { retryable?: unknown } | null)?.retryable !== false;
        if (!retryable || attempt >= retryDelays.length || closing.signal.aborted) {
          if (!closing.signal.aborted) emit({ kind: 'undeliverable', channel: item.channel, requestId: item.requestId, reason: error instanceof Error ? error.message.slice(0, 200) : 'send-failed' });
          return false;
        }
        await sleep(retryDelays[attempt]!, closing.signal);
      }
    }
  }

  /** Send each newly pending question of a run started by a channel message to that message's sender. */
  function watchQuestions(conversation: Conversation): void {
    const key = String(conversation.id);
    if (watchers.has(key) || closing.signal.aborted) return;
    let stop = () => {};
    const run = (async () => {
      const watch = await conversation.watch(context);
      stop = () => { void watch.stop(); };
      if (closing.signal.aborted) { await watch.stop(); return; }
      const seen = new Set<string>();
      let queue = Promise.resolve();
      // Sends are chained off the watch so a slow provider never holds native frames.
      const enqueue = async (view: ConversationView) => {
        const fresh = pendingQuestions(view.entries).filter(question => !seen.has(question.callId));
        if (!fresh.length) return;
        for (const question of fresh) seen.add(question.callId);
        queue = queue.then(async () => {
          const owed = await conversation.commit(async tx => {
            const outbox = await tx.doc(Outbox);
            const out: { item: OutboxItem; question: PendingQuestion }[] = [];
            for (const item of outbox.items.filter(item => String(item.conversationId) === key)) {
              // Only the input whose run is active asked it; a question of a browser-started run stays in the browser.
              if ((await tx.submissionByRequest(conversation.id, item.requestId))?.status !== 'placed') continue;
              for (const question of fresh) if (!item.asked.includes(question.callId)) out.push({ item: copy(item), question });
            }
            return out;
          }, context);
          for (const { item, question } of owed) {
            if (closing.signal.aborted) return;
            if (!await send(item, { kind: 'question', ...question })) continue;
            // Sending cannot share the native commit. A crash before this acknowledgement may repeat the notification.
            await conversation.commit(async tx => {
              const outbox = await tx.doc(Outbox);
              const current = outbox.items.find(value => value.requestId === item.requestId);
              if (current && !current.asked.includes(question.callId)) current.asked.push(question.callId);
            }, context);
          }
        }).catch(() => undefined);
      };
      // The acquisition snapshot is separate from subsequent native watch updates.
      await enqueue(watch.value);
      watch.start(enqueue);
      await watch.closed;
    })().catch(() => undefined).finally(() => { if (watchers.get(key)?.run === run) watchers.delete(key); });
    // Stopping forgets the entry at once, so the next channel message starts a fresh watch.
    watchers.set(key, { run, stop: () => { if (watchers.get(key)?.run === run) watchers.delete(key); stop(); } });
  }

  /** End the question watch once this conversation owes no channel reply. */
  async function releaseWatch(conversationId: ConversationId): Promise<void> {
    const key = String(conversationId);
    const owed = await harness.commit(async tx => (await tx.doc(Outbox)).items.some(item => String(item.conversationId) === key), options.context);
    if (!owed && ![...pendingConversation.values()].includes(key)) watchers.get(key)?.stop();
  }

  /** Submit (idempotently, through `requestId`), wait for the native answer, send it, and drop the owed reply. */
  function deliver(item: OutboxItem): Promise<void> {
    const existing = delivering.get(item.requestId);
    if (existing) return existing;
    const run = (async () => {
      const conversation = await harness.conversation(item.conversationId, context);
      if (!conversation) {
        await settle(item.requestId);
        emit({ kind: 'undeliverable', channel: item.channel, requestId: item.requestId, reason: 'conversation-missing' });
        return;
      }
      watchQuestions(conversation);
      const submission = await conversation.submit({ type: 'input', requestId: item.requestId, content: item.text, whenBusy: 'followUp' }, context);
      const record = await submission.wait(context);
      const answer = record.status === 'done' ? record.answer : undefined;
      const entry = answer === undefined ? undefined : (await conversation.entries({ minEntryId: answer, maxEntryId: answer }, 1, undefined, context)).items[0];
      if (closing.signal.aborted) return;
      await send(item, settledReply(record, entry));
      await settle(item.requestId);
    })().catch(error => {
      // The reply stays owed; the next `start` (or a redelivered webhook) retries it.
      if (!closing.signal.aborted) emit({ kind: 'undeliverable', channel: item.channel, requestId: item.requestId, reason: error instanceof Error ? error.message.slice(0, 200) : 'delivery-failed' });
    }).finally(() => {
      delivering.delete(item.requestId); pendingConversation.delete(item.requestId);
      if (!closing.signal.aborted) void releaseWatch(item.conversationId).catch(() => undefined);
    });
    delivering.set(item.requestId, run); pendingConversation.set(item.requestId, String(item.conversationId));
    return run;
  }

  async function settle(requestId: string): Promise<void> {
    if (closing.signal.aborted) return;
    await harness.commit(async tx => {
      const outbox = await tx.doc(Outbox);
      const index = outbox.items.findIndex(item => item.requestId === requestId);
      if (index >= 0) outbox.items.splice(index, 1);
    }, options.context);
  }

  /** Admit one verified message. Resolves once it is durable, so the webhook may be acknowledged. */
  async function accept(adapter: ChannelAdapter, message: ChannelMessage): Promise<'admitted' | 'answered' | 'duplicate' | 'refused' | 'full'> {
    if (message.channel !== adapter.id || !message.address || !message.messageId) return 'refused';
    const conversation = await route(message);
    if (!conversation) { emit({ kind: 'refused', channel: message.channel, messageId: message.messageId }); return 'refused'; }
    const requestId = channelRequestId(message);
    const text = message.text.slice(0, CHANNELS.maxText);
    // A redelivered webhook: Pi already has this input. Make sure its reply is still being delivered.
    const known = await conversation.commit(async tx => {
      const outbox = await tx.doc(Outbox);
      if (outbox.answers.includes(requestId)) return null;
      if (await tx.submissionByRequest(conversation.id, requestId) === undefined) return undefined;
      const owed = outbox.items.find(item => item.requestId === requestId);
      return owed ? copy(owed) : null;
    }, context);
    if (known !== undefined) {
      if (known) void deliver(known);
      emit({ kind: 'duplicate', channel: message.channel, messageId: message.messageId });
      return 'duplicate';
    }

    // A reply while the agent waits on `ask_user` answers it; the run continues and its answer comes back as usual.
    const question = pendingQuestions((await conversation.context(context)).entries).at(-1);
    if (question) {
      const result = await answerUserQuestion(conversation, question.callId, questionAnswer(question, text), context);
      if (result.kind === 'answered') {
        await conversation.commit(async tx => { const { answers } = await tx.doc(Outbox); answers.push(requestId); if (answers.length > MAX_ANSWERS) answers.splice(0, answers.length - MAX_ANSWERS); }, context);
        emit({ kind: 'answered-question', channel: message.channel, callId: question.callId });
        return 'answered';
      }
      if (result.kind === 'denied') {
        // Sent in the background so the webhook is acknowledged at once.
        const target = { channel: message.channel, address: message.address, requestId };
        void (async () => {
          await send(target, { kind: 'notice', text: result.reason ? `${result.reason}.` : 'That answer was not accepted.' });
          await send(target, { kind: 'question', ...question });
        })();
        return 'answered';
      }
      // A cancelled or concurrently answered question: treat the text as a new message.
    }

    const admitted = await conversation.commit(async tx => {
      const outbox = await tx.doc(Outbox);
      const owed = outbox.items.find(item => item.requestId === requestId);
      if (owed) return copy(owed);
      if (outbox.items.length >= CHANNELS.maxOutbox) return 'full' as const;
      const item: OutboxItem = { requestId, conversationId: conversation.id, channel: message.channel, address: message.address, text, asked: [] };
      outbox.items.push(item);
      return { ...item, asked: [] };
    }, context);
    if (admitted === 'full') return 'full';
    // Submit before acknowledging so the input is in the native inbox. If this throws, the provider redelivers and the
    // owed reply above is found again; `start` also resubmits it after a restart. The reply is awaited in the background.
    await conversation.submit({ type: 'input', requestId, content: text, whenBusy: 'followUp' }, context);
    void deliver(admitted);
    void adapter.received?.(message).catch(() => undefined);
    return 'admitted';
  }

  return {
    handler: channel => {
      const adapter = adapters.get(channel);
      if (!adapter) throw new Error(`Unknown channel adapter: ${channel}`);
      return async request => {
        if (closing.signal.aborted) return reply(503, { reason: 'closing' });
        let receipt: ChannelReceipt;
        try { receipt = await adapter.receive(request); }
        catch { return reply(400, { reason: 'invalid-request' }); }
        if (receipt.kind === 'response') return receipt.response;
        const results: string[] = [];
        try { for (const message of receipt.messages) results.push(await accept(adapter, message)); }
        // Not acknowledged: the provider redelivers, and `requestId` keeps the retry from running twice.
        catch { return reply(503, { reason: 'source-unavailable' }); }
        if (results.includes('full')) return reply(503, { reason: 'outbox-full' });
        return reply(200, { accepted: results.filter(result => result === 'admitted' || result === 'answered').length });
      };
    },
    start: async () => {
      const items = await harness.commit(async tx => (await tx.doc(Outbox)).items.map(copy), context);
      for (const item of items) void deliver(item);
    },
    close: async () => {
      closing.abort();
      const watching = [...watchers.values()];
      for (const watcher of watching) watcher.stop();
      await Promise.allSettled([...delivering.values(), ...watching.map(watcher => watcher.run)]);
    },
  };
}
