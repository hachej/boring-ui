// One preview, from the pending `browser_preview` call to its answer (FEEDBACK.md, "Preview"): find the call in the conversation the
// page already watches, place the report's pins, run the subagent, let the person keep talking to it, then Approve (answer the
// call with the net changes) or Discard (answer `discarded`). Either way the page is reverted once the answer is accepted: nothing
// was saved, and the approved changes travel in the answer. React-free external state for the banner.
import type { Api, Model, Models } from '@earendil-works/pi-ai';
import type { PrivacyPolicy } from '../page/index.js';
import type { PreviewAnswer, PreviewChange } from '../format/index.js';
import { createPreviewPage, type PreviewPage } from './page.js';
import { createPreviewAgent, type PreviewAgent } from './agent.js';

export const BROWSER_PREVIEW_TOOL = 'browser_preview';

/** A pending browser task found in a conversation view: its answer id (`[assistantEntryId, callId]`) and its arguments. */
export interface PendingBrowserTask {
  readonly id: string;
  readonly callId: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

interface ViewLike {
  readonly entries: readonly { readonly id: number | bigint | string; readonly model?: readonly unknown[] | undefined }[];
  readonly docs?: Readonly<Record<string, unknown>>;
}

/**
 * The calls of `tool` in a conversation view that have no result yet, oldest first, while the conversation is running. The id is the
 * binding `browserTaskId(entry, call)` of `@hachej/boring-agent/browser-task`, which the chat transport's `answer` takes.
 */
export function pendingBrowserTasks(view: ViewLike | undefined, tool: string = BROWSER_PREVIEW_TOOL): readonly PendingBrowserTask[] {
  if (!view) return [];
  const live = view.docs?.['pi.live'] as { readonly run?: unknown } | undefined;
  if (!live?.run) return [];
  const calls = new Map<string, PendingBrowserTask>();
  for (const entry of view.entries) for (const message of entry.model ?? []) {
    const item = message as { readonly role?: string; readonly content?: unknown; readonly toolCallId?: string };
    if (item.role === 'assistant' && Array.isArray(item.content)) {
      for (const part of item.content as { type?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[]) {
        if (part.type === 'toolCall' && part.name === tool && typeof part.id === 'string') {
          calls.set(part.id, { id: JSON.stringify([Number(entry.id), part.id]), callId: part.id, arguments: part.arguments ?? {} });
        }
      }
    }
    if (item.role === 'toolResult' && typeof item.toolCallId === 'string') calls.delete(item.toolCallId);
  }
  return [...calls.values()];
}

export type PreviewStatus = 'starting' | 'working' | 'ready' | 'failed' | 'answering' | 'approved' | 'discarded';

export interface PreviewSnapshot {
  readonly status: PreviewStatus;
  /** The subagent's last sentence. */
  readonly summary: string;
  readonly changes: readonly PreviewChange[];
  /** Why the last step failed or the answer was refused. */
  readonly error?: string;
}

export interface PreviewSession {
  readonly getSnapshot: () => PreviewSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Places the pins and runs the instructions. */
  readonly start: () => Promise<void>;
  /** A follow-up to the subagent ("darker"). */
  readonly say: (text: string) => Promise<void>;
  readonly approve: () => Promise<void>;
  readonly discard: () => Promise<void>;
  /** Reverts the page without answering (the page is closing, or another preview replaces this one). */
  readonly dispose: () => void;
}

export type PreviewAnswerOutcome = { readonly kind: 'answered' } | { readonly kind: string; readonly reason?: string };

export interface PreviewSessionOptions {
  readonly task: PendingBrowserTask;
  readonly root: () => Element | null;
  readonly policy: PrivacyPolicy;
  readonly models: Models;
  readonly model: Model<Api>;
  /** The anchors of the report the call names (`arguments.feedback`), read with the person's own access; none when it names none. */
  readonly anchors?: (feedbackId: string) => Promise<readonly unknown[]>;
  /** Sends the answer through the host's authenticated path (the chat transport's `answer` with `task.id`). */
  readonly answer: (id: string, answer: string) => Promise<PreviewAnswerOutcome>;
}

export function createPreviewSession(options: PreviewSessionOptions): PreviewSession {
  let snapshot: PreviewSnapshot = Object.freeze({ status: 'starting', summary: '', changes: Object.freeze([]) });
  const listeners = new Set<() => void>();
  const publish = (change: Partial<PreviewSnapshot>) => {
    const { error: _old, ...rest } = snapshot;
    snapshot = Object.freeze({ ...rest, ...change });
    for (const listener of [...listeners]) listener();
  };
  let page: PreviewPage | undefined, agent: PreviewAgent | undefined;
  const abort = new AbortController();
  const settled = () => snapshot.status === 'approved' || snapshot.status === 'discarded';
  const instructions = typeof options.task.arguments['instructions'] === 'string' ? options.task.arguments['instructions'] : '';
  const feedback = typeof options.task.arguments['feedback'] === 'string' ? options.task.arguments['feedback'] : undefined;

  const step = async (text?: string) => {
    if (!agent || !page || settled()) return;
    publish({ status: 'working' });
    const outcome = await agent.say(text, abort.signal);
    if (settled()) return;
    publish('error' in outcome
      ? { status: page.changes().length ? 'ready' : 'failed', changes: page.changes(), error: outcome.error }
      : { status: 'ready', summary: outcome.text, changes: page.changes() });
  };
  const send = async (answer: PreviewAnswer, status: 'approved' | 'discarded') => {
    publish({ status: 'answering' });
    try {
      const outcome = await options.answer(options.task.id, JSON.stringify(answer));
      // Approved or discarded, the live page goes back to what is really saved: the approved changes travel in the answer.
      if (outcome.kind === 'answered') { page?.revert(); publish({ status }); return; }
      publish({ status: 'ready', error: ('reason' in outcome && outcome.reason) || `The answer was not accepted (${outcome.kind}).` });
    } catch (error) { publish({ status: 'ready', error: error instanceof Error ? error.message : 'The answer could not be sent.' }); }
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: async () => {
      if (page) return;
      const root = options.root();
      if (!root) { publish({ status: 'failed', error: 'The application page is not open here.' }); return; }
      let anchors: readonly unknown[] = [];
      if (feedback && options.anchors) { try { anchors = await options.anchors(feedback); } catch { /* preview without pins */ } }
      page = await createPreviewPage({ root, policy: options.policy, anchors });
      agent = createPreviewAgent({ models: options.models, model: options.model, page, instructions: instructions || 'Preview the requested change.' });
      await step();
    },
    say: async (text: string) => { if (text.trim() && snapshot.status !== 'working') await step(text.trim()); },
    approve: async () => { if (agent && !settled() && snapshot.status !== 'working') await send(agent.approve(), 'approved'); },
    discard: async () => {
      if (settled()) return;
      abort.abort();
      if (agent) { await send(agent.discard(), 'discarded'); return; }
      page?.revert();
      await send({ kind: 'discarded' }, 'discarded');
    },
    dispose: () => { abort.abort(); page?.revert(); listeners.clear(); },
  });
}
