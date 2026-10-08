import type { ReactNode } from 'react';
import type { ConversationView, EntryRecord, InboxItem, JsonObject } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';
import type { AssistantMessage, Message, ToolCall, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { ToolEntry, ToolStatus } from './tool';
import { ASK_USER_TOOL } from './question-card';
import { PRESENT_TOOL, artifactKey, detectArtifact, pendingId, pendingTitle } from './artifact';
import type { ArtifactDescriptor, ArtifactsConfig } from './artifact';

/** The host adds file content for `@path` mentions as parts that start like this; the message already shows the mention itself. */
export const isFileBlock = (text: string): boolean => text.startsWith('<file path="');

/** A submission waiting in the native inbox (steer or follow-up); `queuedMessages` reads them from the view, the queue renders them. */
export type QueuedMessage = Extract<InboxItem, { readonly mode: 'steer' | 'followUp' }>;

/*
 * The one message model is the native Pi view: entries (with their model messages) plus the live `pi.live` document.
 * This module turns a view into display rows with these semantics: tool calls are matched with tool results, expert mode hides successful tool details, the live
 * generation is appended as a streaming row whose key matches the row its committed message will take.
 */
/** `required` pins the card above the transcript. `inline` (tool cards) keeps it in place in expert mode too, like the
 * question and artifact cards; other custom tool cards show only in developer mode or on failure. */
export interface ChatCard { readonly content: ReactNode; readonly required?: boolean; readonly inline?: boolean }
export type Mode = 'expert' | 'developer';
export type StreamPart = { readonly type: 'text'; readonly text: string } | { readonly type: 'thinking'; readonly thinking: string } | ToolCall;

export type Part =
  | { readonly kind: 'text'; readonly key: string; readonly text: string }
  | { readonly kind: 'thinking'; readonly key: string; readonly text: string; readonly streaming: boolean }
  | { readonly kind: 'question'; readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; readonly live: boolean; readonly questionId: string | undefined }
  | { readonly kind: 'approval'; readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; readonly live: boolean; /** The bound question ID the answer must use (as for `question`). */ readonly questionId: string | undefined; /** The one-line summary `requireApproval` published for this call. */ readonly summary: string; /** The decision it recorded, once made. */ readonly decision?: ApprovalDecision; /** The call's own step, shown in the activity block once it has a result. */ readonly entry?: ToolEntry }
  | { readonly kind: 'artifact'; readonly key: string; readonly call: ToolCall; readonly state: 'presenting' | 'ready'; readonly artifact: ArtifactDescriptor | undefined; readonly title: string | undefined; /** Set when the host's `detect` found the descriptor: the call stays a step of the activity block too. */ readonly entry?: ToolEntry }
  | { readonly kind: 'tool'; readonly key: string; readonly entry: ToolEntry };

export type Row =
  | { readonly key: string; readonly type: 'user'; readonly message: UserMessage }
  | { readonly key: string; readonly type: 'assistant'; readonly parts: readonly Part[]; readonly streaming: boolean; /** The turn is still running (the last row while a run is active). */ readonly active?: boolean; readonly stopReason?: AssistantMessage['stopReason']; readonly errorMessage?: string; readonly text: string; /** When the reply was written (the last round of a merged turn), in ms. Absent while it streams. */ readonly timestamp?: number; /** The native entry of its last committed round: where a fork of the conversation after this reply starts. */ readonly entryId?: string }
  | { readonly key: string; readonly type: 'orphan-result'; readonly message: ToolResultMessage }
  | { readonly key: string; readonly type: 'system'; readonly text: string }
  | { readonly key: string; readonly type: 'event'; readonly label: string }
  | { readonly key: string; readonly type: 'card'; readonly card: ChatCard };

export function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
export function streamParts(value: JsonValue | undefined): StreamPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): StreamPart[] => {
    const part = object(item);
    if (part?.['type'] === 'text' && typeof part['text'] === 'string') return [{ type: 'text', text: part['text'] }];
    if (part?.['type'] === 'thinking' && typeof part['thinking'] === 'string') return [{ type: 'thinking', thinking: part['thinking'] }];
    const args = object(part?.['arguments']);
    if (part?.['type'] === 'toolCall' && typeof part['id'] === 'string' && typeof part['name'] === 'string' && args) return [{ type: 'toolCall', id: part['id'], name: part['name'], arguments: args }];
    return [];
  });
}

export function queuedMessages(view: ConversationView | undefined): QueuedMessage[] {
  const items = object(view?.docs['pi.inbox'])?.['items'];
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is QueuedMessage => {
    const value = object(item as JsonValue);
    return value !== undefined && (value['mode'] === 'steer' || value['mode'] === 'followUp') && value['id'] !== undefined;
  });
}

export interface Derived {
  readonly rows: readonly Row[];
  /** Required entry and tool cards: pinned above the transcript. */
  readonly pinned: readonly { readonly key: string; readonly content: ReactNode }[];
  readonly run: JsonObject | undefined;
  readonly retry: JsonObject | undefined;
  readonly compacting: boolean;
}
export interface DeriveOptions {
  readonly mode: Mode;
  readonly renderEntry: ((entry: EntryRecord) => ChatCard | undefined) | undefined;
  readonly renderTool: ((call: ToolCall, result: ToolResultMessage | undefined) => ChatCard | undefined) | undefined;
  readonly groupTool: ((call: ToolCall, result: ToolResultMessage) => boolean) | undefined;
  /** Turn artifact tool results into cards (`detect` recognises descriptors the tool result does not carry itself). */
  readonly artifacts?: { readonly detect?: ArtifactsConfig['detect'] | undefined } | undefined;
}

/** Key of `{ summary, decision? }` in a gated call's details: `APPROVAL_DETAILS` of `@hachej/boring-agent/approval` (a contract test keeps them equal). */
export const APPROVAL_DETAILS = 'boring.approval';
export type ApprovalDecision = 'approved' | 'denied' | 'cancelled';
/** The approval record a gated call publishes: its summary and, once made, the decision (`approved`, `denied` or `cancelled`). */
const approvalRecord = (details: unknown): { summary: string; decision?: ApprovalDecision } | undefined => {
  const record = object(object(details as JsonValue | undefined)?.[APPROVAL_DETAILS]);
  const summary = record?.['summary'], decision = record?.['decision'];
  if (typeof summary !== 'string' || !summary.trim()) return undefined;
  return { summary: summary.trim(), ...(decision === 'approved' || decision === 'denied' || decision === 'cancelled' ? { decision } : {}) };
};

const textOf = (message: Message): string => message.role === 'assistant' ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') : '';

export function derive(view: ConversationView | undefined, options: DeriveOptions): Derived {
  const { mode, renderEntry, renderTool } = options;
  const developer = mode === 'developer';
  const live = object(view?.docs['pi.live']);
  const run = object(live?.['run']), generation = object(live?.['generation']);
  const liveMessage = object(generation?.['message']), retry = object(generation?.['retry']);
  const taskId = run?.['taskId'];

  // Pass 1: match each result to its preceding invocation. Model call IDs may be reused.
  type Item = { readonly key: string; readonly entry: EntryRecord; readonly message?: Message; readonly card?: ChatCard };
  const items: Item[] = [], results = new Map<ToolCall, ToolResultMessage>(), counts = new Map<number, number>(), questionIds = new Map<ToolCall, string>();
  const pendingCalls = new Map<string, ToolCall>();
  for (const entry of view?.entries ?? []) {
    const custom = renderEntry?.(entry);
    const card = custom && (developer || custom.required) ? custom : undefined;
    if (card) items.push({ key: `entry:${entry.id}`, entry, card });
    if (!entry.model?.length) { if (!card && developer) items.push({ key: `entry:${entry.id}`, entry }); continue; }
    for (const [index, message] of entry.model.entries()) {
      if (message.role === 'assistant') for (const part of message.content) if (part.type === 'toolCall') { pendingCalls.set(part.id, part); questionIds.set(part, JSON.stringify([entry.id, part.id])); }
      if (message.role === 'toolResult') {
        const call = pendingCalls.get(message.toolCallId);
        if (call) { results.set(call, message); pendingCalls.delete(message.toolCallId); }
      }
      let key = `entry:${entry.id}:${index}`;
      if (message.role === 'assistant' && entry.byTaskId !== undefined) {
        const ordinal = counts.get(entry.byTaskId) ?? 0; counts.set(entry.byTaskId, ordinal + 1);
        key = `assistant:${entry.byTaskId}:${ordinal}`;
      }
      if (!card) items.push({ key, entry, message });
    }
  }
  const matched = new Set(results.values());

  const pinned: { key: string; content: ReactNode }[] = [];
  for (const item of items) if (item.card?.required) pinned.push({ key: item.key, content: item.card.content });

  const status = (result: ToolResultMessage | undefined): ToolStatus => result ? (result.isError ? 'failed' : 'completed') : run ? 'running' : 'unfinished';
  function toolPart(call: ToolCall, key: string, committed: boolean): Part | undefined {
    const result = results.get(call);
    if (call.name === ASK_USER_TOOL) return { kind: 'question', key, call, result, live: !committed, questionId: questionIds.get(call) };
    // A call gated by `requireApproval` identifies itself: it publishes its summary under APPROVAL_DETAILS before it asks.
    const record = approvalRecord(result ? result.details : (Array.isArray(live?.['tools']) ? live['tools'] : []).map(object).find(slot => slot?.['callId'] === call.id)?.['details']);
    if (record) return { kind: 'approval', key, call, result, live: !committed, questionId: questionIds.get(call), summary: record.summary, ...(record.decision ? { decision: record.decision } : {}), ...(result ? { entry: { key: `${key}:step`, call, result, status: status(result) } } : {}) };
    if (options.artifacts) {
      // A finished call that carries a descriptor becomes a card; a running `present` shows an "opening" card. A failed call stays an ordinary (failed) tool step.
      const artifact = result ? detectArtifact(call, result, options.artifacts.detect) : undefined;
      if (artifact) {
        // A tool whose own result carries the descriptor is replaced by its card; a host-detected card is shown in addition to the step.
        const own = result && detectArtifact(call, result);
        return { kind: 'artifact', key, call, state: 'ready', artifact, title: artifact.title, ...(own ? {} : { entry: { key, call, result, status: status(result) } }) };
      }
      if (!result && run && call.name === PRESENT_TOOL) {
        return { kind: 'artifact', key, call, state: 'presenting', artifact: undefined, title: pendingTitle(call) };
      }
    }
    const custom = committed ? renderTool?.(call, result) : undefined;
    if (custom?.required) { pinned.push({ key, content: custom.content }); return undefined; }
    if (custom && (developer || result?.isError || custom.inline)) return { kind: 'tool', key, entry: { key, call, result, status: status(result), custom: custom.content } };
    // A host that folds only some calls (`groupTool`) keeps the rest as cards, which expert mode hides unless they failed.
    if (!developer && !result?.isError && options.groupTool && !(result && safe(options.groupTool, { key, call, result, status: status(result) }))) return undefined;
    return { kind: 'tool', key, entry: { key, call, result, status: status(result) } };
  }
  function partsOf(content: readonly StreamPart[], rowKey: string, streaming: boolean, committed: boolean): Part[] {
    const parts: Part[] = [];
    for (const [index, part] of content.entries()) {
      if (part.type === 'text') { if (part.text.length) parts.push({ kind: 'text', key: `${rowKey}:text:${index}`, text: part.text }); }
      else if (part.type === 'thinking') { if (developer && part.thinking.length) parts.push({ kind: 'thinking', key: `${rowKey}:thinking:${index}`, text: part.thinking, streaming: streaming && index === content.length - 1 }); }
      else { const made = toolPart(part, `${rowKey}:tool:${index}`, committed); if ((made?.kind === 'artifact' || made?.kind === 'approval') && made.entry) parts.push({ kind: 'tool', key: `${made.key}:step`, entry: made.entry }); if (made) parts.push(made); }
    }
    return parts;
  }

  // Pass 2: rows.
  const rows: Row[] = [];
  for (const item of items) {
    if (item.card) { if (!item.card.required) rows.push({ key: item.key, type: 'card', card: item.card }); continue; }
    const message = item.message;
    if (!message) { if (developer) rows.push({ key: item.key, type: 'event', label: item.entry.kind }); continue; }
    if (message.role === 'system') {
      if (developer) rows.push({ key: item.key, type: 'system', text: typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join('\n') });
    } else if (message.role === 'toolResult') {
      // A result with its call is shown on the call's card. Only an unmatched failure gets its own row.
      if (message.isError && !matched.has(message)) rows.push({ key: item.key, type: 'orphan-result', message });
    } else if (message.role === 'user') rows.push({ key: item.key, type: 'user', message });
    else {
      const parts = partsOf(message.content, item.key, false, true);
      const interrupted = message.stopReason === 'error' || message.stopReason === 'aborted';
      if (parts.length || interrupted) rows.push({ key: item.key, type: 'assistant', parts, streaming: false, stopReason: message.stopReason, ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}), text: textOf(message), ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}), entryId: String(item.entry.id) });
    }
  }
  if (typeof taskId === 'number' && liveMessage) {
    const key = `assistant:${taskId}:${counts.get(taskId) ?? 0}`, content = streamParts(liveMessage['content']);
    rows.push({ key, type: 'assistant', parts: partsOf(content, key, true, false), streaming: true, text: '' });
  }
  const merged = mergeTurns(rows).map(row => row.type === 'assistant' && options.artifacts ? { ...row, parts: oneCardPerArtifact(row.parts) } : row);
  const last = merged[merged.length - 1];
  if (run && last?.type === 'assistant') merged[merged.length - 1] = { ...last, active: true };
  return { rows: merged, pinned, run, retry, compacting: Array.isArray(live?.['compactions']) && live['compactions'].length > 0 };
}

/**
 * Pi commits one assistant message per model round, so a turn with tool use is several messages in a row.
 * They read as one answer: merge consecutive assistant rows (unless one ended in an error or stop) so tool calls
 * group across rounds and the turn has a single copy action. The first row's key is kept, so identity is stable.
 */
function mergeTurns(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last?.type === 'assistant' && row.type === 'assistant' && !last.stopReason?.match(/^(error|aborted)$/)) {
      out[out.length - 1] = { key: last.key, type: 'assistant', parts: [...last.parts, ...row.parts], streaming: row.streaming,
        ...(row.stopReason ? { stopReason: row.stopReason } : {}), ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
        text: [last.text, row.text].filter(Boolean).join('\n\n'), ...(row.timestamp !== undefined ? { timestamp: row.timestamp } : {}),
        ...(row.entryId !== undefined ? { entryId: row.entryId } : last.entryId !== undefined ? { entryId: last.entryId } : {}) };
    } else out.push(row);
  }
  return out;
}

/**
 * A turn that revises an artifact several times shows one card for it: the last version, at the place of the last step.
 * A running `present` of a file already shown takes over the title of its card.
 */
function oneCardPerArtifact(parts: readonly Part[]): Part[] {
  const idOf = (part: Part) => part.kind === 'artifact' ? part.artifact ? artifactKey(part.artifact) : (part.state === 'presenting' ? pendingId(part.call) : undefined) : undefined;
  const last = new Map<string, number>();
  for (const [index, part] of parts.entries()) { const id = idOf(part); if (id !== undefined) last.set(id, index); }
  const out: Part[] = [];
  for (const [index, part] of parts.entries()) {
    const id = idOf(part);
    if (id === undefined || last.get(id) === index) {
      if (part.kind === 'artifact' && part.artifact === undefined && part.title === undefined && id !== undefined) {
        const earlier = parts.find(other => other.kind === 'artifact' && other.artifact !== undefined && artifactKey(other.artifact) === id);
        if (earlier?.kind === 'artifact') { out.push({ ...part, title: earlier.title }); continue; }
      }
      out.push(part);
    }
  }
  return out;
}

/** One step of an activity block: a default tool call or a stretch of reasoning. */
export type Step = { readonly kind: 'tool'; readonly key: string; readonly entry: ToolEntry }
  | { readonly kind: 'thinking'; readonly key: string; readonly text: string; readonly streaming: boolean };
/** An assistant turn is text parts and activity blocks: one block per uninterrupted run of steps. */
export type Segment = { readonly kind: 'part'; readonly part: Part } | { readonly kind: 'activity'; readonly key: string; readonly steps: readonly Step[] };
export function segments(parts: readonly Part[], groupTool: DeriveOptions['groupTool']): Segment[] {
  const out: Segment[] = [];
  let run: Step[] = [];
  const flush = () => {
    const first = run[0];
    if (first) out.push({ kind: 'activity', key: `activity:${first.key}`, steps: run });
    run = [];
  };
  for (const part of parts) {
    if (part.kind === 'thinking') run.push({ kind: 'thinking', key: part.key, text: part.text, streaming: part.streaming });
    else if (part.kind === 'tool' && !part.entry.custom && (!groupTool || safe(groupTool, part.entry))) run.push({ kind: 'tool', key: part.key, entry: part.entry });
    else { flush(); out.push({ kind: 'part', part }); }
  }
  flush();
  return out;
}
function safe(groupTool: NonNullable<DeriveOptions['groupTool']>, entry: ToolEntry): boolean {
  try { return entry.result !== undefined && !entry.result.isError && groupTool(entry.call, entry.result) === true; } catch { return false; }
}
