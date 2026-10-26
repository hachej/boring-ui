/**
 * Optional chat view rules: what a native Pi conversation view means for a chat surface. Pure functions over Pi types; no React,
 * files, agent or controller runtime. Registry items (pi-chat, pi-ambient, ...) draw these rows and words, they do not re-derive them.
 *
 * `Content` is whatever the surface renders (React nodes in the registry); this module never reads it.
 */
import type { ConversationView, EntryRecord, InboxItem, JsonObject } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';
import type { AssistantMessage, ImageContent, Message, ToolCall, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { ChatSnapshot } from './native-chat.js';

/** The tool that asks the person a question (`ask_user` of `@hachej/boring-agent/ask-user`). Its calls are question parts. */
export const ASK_USER_TOOL = 'ask_user';
/** Key of `{ summary, decision? }` in a gated call's details: `APPROVAL_DETAILS` of `@hachej/boring-agent/approval` (a contract test keeps them equal). */
export const APPROVAL_DETAILS = 'boring.approval';
/** The decision `requireApproval` records for a gated call. */
export type ApprovalDecision = 'approved' | 'denied' | 'cancelled';

/** The host adds file content for `@path` mentions as parts that start like this; the message already shows the mention itself. */
export const isFileBlock = (text: string): boolean => text.startsWith('<file path="');

/** A marked app context stays in the native message; presentation collapses only a valid leading target block to a chip. */
export function targetContent(text: string): { readonly target: JsonObject; readonly speech: string; readonly label: string } | undefined {
  if (!text.startsWith('<target>')) return;
  const end = text.indexOf('</target>');
  if (end < 0 || text.slice(end + 9, end + 11) !== '\n\n') return;
  const json = text.slice(8, end);
  if (new TextEncoder().encode(json).length > 1024) return;
  try {
    const target = object(JSON.parse(json));
    if (!target) return;
    const label = Object.entries(target).map(([key, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? `${key}: ${value}` : key).join(' · ') || 'Target';
    return { target, speech: text.slice(end + 11), label };
  } catch { return; }
}

/** A submission waiting in the native inbox (steer or follow-up); `queuedMessages` reads them from the view, the queue renders them. */
export type QueuedMessage = Extract<InboxItem, { readonly mode: 'steer' | 'followUp' }>;

export type ToolStatus = 'running' | 'completed' | 'failed' | 'unfinished';
export interface ToolEntry<Content = unknown> { readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; readonly status: ToolStatus; readonly custom?: Content }

/**
 * An artifact a tool call made (or a running `present` call is making), as the chat places it. `descriptor` is the artifacts item's own
 * value: the chat hands it back to the host's `open` and `isOpen` and never reads it.
 */
export interface ChatArtifact {
  readonly state: 'presenting' | 'ready';
  /** One card per id in a reply: the last version, at the place of its last step. */
  readonly id: string | undefined;
  readonly title: string | undefined;
  /** The workspace path, for the conversation's file list. */
  readonly path: string | undefined;
  /** The tool's own result carries it, so its card replaces the step; a host-detected one is shown in addition to the step. */
  readonly own: boolean;
  readonly descriptor: unknown;
}
/** Finds an artifact descriptor a finished call's result does not carry itself (the host's `detect`). */
export type ArtifactDetect = (call: ToolCall, result: ToolResultMessage) => unknown;
/** The artifact a call made, or that a running call (`running`) is making; undefined for any other call. */
export type ArtifactRecognise = (call: ToolCall, result: ToolResultMessage | undefined, running: boolean, detect: ArtifactDetect | undefined) => ChatArtifact | undefined;
/**
 * Draws a tool call that ran a sub-agent, from the details its running slot published (`details`) or that it finished with.
 * Undefined: the call is not a sub-agent call and stays an ordinary tool step.
 */
export type SubagentRenderer<Content = unknown> = (call: ToolCall, details: unknown, result: ToolResultMessage | undefined) => Content | undefined;

/*
 * The one message model is the native Pi view: entries (with their model messages) plus the live `pi.live` document.
 * This module turns a view into display rows with these semantics: tool calls are matched with tool results, expert mode hides successful tool details, the live
 * generation is appended as a streaming row whose key matches the row its committed message will take.
 */
/** `required` pins the card above the transcript. `inline` keeps an entry/tool card in place in expert mode too;
 * inline entries remain part of the answer. Other custom tool cards show only in developer mode or on failure. */
export interface ChatCard<Content = unknown> { readonly content: Content; readonly required?: boolean; readonly inline?: boolean; /** Host stage wording for the single natural status; null clears it. */ readonly status?: Content }
export type Mode = 'expert' | 'developer';
export type StreamPart = { readonly type: 'text'; readonly text: string } | { readonly type: 'thinking'; readonly thinking: string } | ToolCall;

export type QuestionPart = { readonly kind: 'question'; readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; readonly live: boolean; readonly questionId: string | undefined };
export type ApprovalPart<Content = unknown> = { readonly kind: 'approval'; readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; readonly live: boolean; /** The bound question ID the answer must use (as for `question`). */ readonly questionId: string | undefined; /** The one-line summary `requireApproval` published for this call. */ readonly summary: string; /** The decision it recorded, once made. */ readonly decision?: ApprovalDecision; /** The call's own step, shown in the activity block once it has a result. */ readonly entry?: ToolEntry<Content> };
export type Part<Content = unknown> =
  | { readonly kind: 'card'; readonly key: string; readonly content: Content }
  | { readonly kind: 'text'; readonly key: string; readonly text: string }
  | { readonly kind: 'thinking'; readonly key: string; readonly text: string; readonly streaming: boolean }
  | QuestionPart
  | ApprovalPart<Content>
  | { readonly kind: 'subagent'; readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; /** The sub-agent card, from the details the call published (live) or finished with. */ readonly content: Content; /** The call's own step, shown in the activity block once it has a result. */ readonly entry?: ToolEntry<Content> }
  | { readonly kind: 'artifact'; readonly key: string; readonly call: ToolCall; readonly artifact: ChatArtifact; /** Set when the host's `detect` found the descriptor: the call stays a step of the activity block too. */ readonly entry?: ToolEntry<Content> }
  | { readonly kind: 'tool'; readonly key: string; readonly entry: ToolEntry<Content> };

export type Row<Content = unknown> = (
  | { readonly key: string; readonly type: 'user'; readonly message: UserMessage; /** `messageStyle="messaging"`: first of a run (see `markLeads`). */ readonly lead?: boolean }
  | { readonly key: string; readonly type: 'assistant'; readonly lead?: boolean; readonly parts: readonly Part<Content>[]; /** Native result images remain visible when their tool chrome is omitted. */ readonly images?: readonly ImageContent[]; readonly streaming: boolean; /** The turn is still running (the last row while a run is active). */ readonly active?: boolean; readonly stopReason?: AssistantMessage['stopReason']; readonly errorMessage?: string; readonly text: string; /** When the reply was written (the last round of a merged turn), in ms. Absent while it streams. */ readonly timestamp?: number; /** The model that wrote the last round of the reply. */ readonly model?: { readonly provider: string; readonly modelId: string }; /** Sum of the merged rounds' native `durationMs`, when recorded. */ readonly durationMs?: number; /** The native entry of its last committed round: where a fork of the conversation after this reply starts. */ readonly entryId?: string }
  | { readonly key: string; readonly type: 'orphan-result'; readonly message: ToolResultMessage }
  | { readonly key: string; readonly type: 'system'; readonly text: string }
  | { readonly key: string; readonly type: 'event'; readonly label: string }
  | { readonly key: string; readonly type: 'card'; readonly card: ChatCard<Content> }) & { readonly historical?: boolean };

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

export interface Derived<Content = unknown> {
  readonly rows: readonly Row<Content>[];
  /** Required entry and tool cards: pinned above the transcript. */
  readonly pinned: readonly { readonly key: string; readonly content: Content }[];
  readonly run: JsonObject | undefined;
  readonly retry: JsonObject | undefined;
  readonly compacting: boolean;
  readonly stageStatus?: Content;
}
export interface DeriveOptions<Content = unknown> {
  readonly mode: Mode;
  /** Complete assistant lines to omit. With live text, the unfinished last line waits for its newline or settlement. */
  readonly hideLine?: ((line: string) => boolean) | undefined;
  readonly renderEntry: ((entry: EntryRecord) => ChatCard<Content> | undefined) | undefined;
  readonly renderTool: ((call: ToolCall, result: ToolResultMessage | undefined) => ChatCard<Content> | undefined) | undefined;
  readonly groupTool: ((call: ToolCall, result: ToolResultMessage) => boolean) | undefined;
  /** Turn artifact tool results into cards (`recognise`; `detect` finds descriptors the tool result does not carry itself). */
  readonly artifacts?: { readonly recognise: ArtifactRecognise; readonly detect?: ArtifactDetect | undefined } | undefined;
  /** Draws sub-agent calls. Without it they are ordinary tool steps. */
  readonly subagent?: SubagentRenderer<Content> | undefined;
  /** `natural` shows only what a non-developer reads: their messages, the assistant's prose and the question, approval and artifact cards. Tool steps, reasoning, system rows and raw error text are left out of the rows (the entries stay as they are). */
  readonly presentation?: 'natural' | undefined;
}

/** The approval record a gated call publishes: its summary and, once made, the decision (`approved`, `denied` or `cancelled`). */
const approvalRecord = (details: unknown): { summary: string; decision?: ApprovalDecision } | undefined => {
  const record = object(object(details as JsonValue | undefined)?.[APPROVAL_DETAILS]);
  const summary = record?.['summary'], decision = record?.['decision'];
  if (typeof summary !== 'string' || !summary.trim()) return undefined;
  return { summary: summary.trim(), ...(decision === 'approved' || decision === 'denied' || decision === 'cancelled' ? { decision } : {}) };
};

function visibleText(text: string, streaming: boolean, hideLine: DeriveOptions['hideLine']): string {
  if (!hideLine) return text;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return lines.filter(line => (!streaming || line.endsWith('\n')) && !hideLine(line.replace(/\r?\n$/, ''))).join('');
}
const textOf = (parts: readonly Part<unknown>[]): string => parts.flatMap(part => part.kind === 'text' ? [part.text] : []).join('\n');

/** The display rows of a native conversation view, plus its run, retry, compaction and pinned cards. */
export function derive<Content = unknown>(view: ConversationView | undefined, options: DeriveOptions<Content>): Derived<Content> {
  type P = Part<Content>;
  type R = Row<Content>;
  const { mode, renderEntry, renderTool } = options;
  const natural = options.presentation === 'natural';
  const developer = mode === 'developer' && !natural;
  const live = object(view?.docs['pi.live']);
  const run = object(live?.['run']), generation = object(live?.['generation']);
  const liveMessage = object(generation?.['message']), retry = object(generation?.['retry']);
  const taskId = run?.['taskId'];

  // Pass 1: match each result to its preceding invocation. Model call IDs may be reused.
  type Item = { readonly key: string; readonly entry: EntryRecord; readonly message?: Message; readonly card?: ChatCard<Content> };
  let stageStatus: Content | undefined;
  const items: Item[] = [], results = new Map<ToolCall, ToolResultMessage>(), counts = new Map<number, number>(), questionIds = new Map<ToolCall, string>();
  const pendingCalls = new Map<string, ToolCall>();
  for (const entry of view?.entries ?? []) {
    const custom = renderEntry?.(entry);
    if (custom && 'status' in custom) stageStatus = custom.status;
    const card = custom && (developer || custom.required || custom.inline) ? custom : undefined;
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

  const pinned: { key: string; content: Content }[] = [];
  for (const item of items) if (item.card?.required) pinned.push({ key: item.key, content: item.card.content });

  const status = (result: ToolResultMessage | undefined): ToolStatus => result ? (result.isError ? 'failed' : 'completed') : run ? 'running' : 'unfinished';
  function toolPart(call: ToolCall, key: string, committed: boolean): P | undefined {
    const result = results.get(call);
    if (call.name === ASK_USER_TOOL) return { kind: 'question', key, call, result, live: !committed, questionId: questionIds.get(call) };
    // A call gated by `requireApproval` identifies itself: it publishes its summary under APPROVAL_DETAILS before it asks.
    const slotDetails = result ? undefined : (Array.isArray(live?.['tools']) ? live['tools'] : []).map(object).find(slot => slot?.['callId'] === call.id)?.['details'];
    const record = approvalRecord(result ? result.details : slotDetails);
    if (record) return { kind: 'approval', key, call, result, live: !committed, questionId: questionIds.get(call), summary: record.summary, ...(record.decision ? { decision: record.decision } : {}), ...(result ? { entry: { key: `${key}:step`, call, result, status: status(result) } } : {}) };
    // A `delegate` call (or any tool publishing `DelegateDetails`) is a sub-agent card, live from its running slot, when the sub-agent item draws it.
    const delegated = options.subagent?.(call, result ? result.details : slotDetails, result);
    if (delegated !== undefined) return { kind: 'subagent', key, call, result, content: delegated, ...(result ? { entry: { key: `${key}:step`, call, result, status: status(result) } } : {}) };
    // With the artifacts item, a finished call that carries a descriptor becomes a card and a running `present` an "opening" card. A failed call stays an ordinary (failed) tool step.
    const artifact = options.artifacts?.recognise(call, result, !result && run !== undefined, options.artifacts.detect);
    // A tool whose own result carries the descriptor is replaced by its card; a host-detected card is shown in addition to the step.
    if (artifact) return { kind: 'artifact', key, call, artifact, ...(result && !artifact.own ? { entry: { key, call, result, status: status(result) } } : {}) };
    const custom = committed ? renderTool?.(call, result) : undefined;
    if (custom?.required) { pinned.push({ key, content: custom.content }); return undefined; }
    if (natural) return undefined;
    if (custom && (developer || result?.isError || custom.inline)) return { kind: 'tool', key, entry: { key, call, result, status: status(result), custom: custom.content } };
    // A host that folds only some calls (`groupTool`) keeps the rest as cards, which expert mode hides unless they failed.
    if (!developer && !result?.isError && options.groupTool && !(result && safe(options.groupTool, { key, call, result, status: status(result) }))) return undefined;
    return { kind: 'tool', key, entry: { key, call, result, status: status(result) } };
  }
  function partsOf(content: readonly StreamPart[], rowKey: string, streaming: boolean, committed: boolean): P[] {
    const parts: P[] = [];
    for (const [index, part] of content.entries()) {
      if (part.type === 'text') { const text = visibleText(part.text, streaming && index === content.length - 1, options.hideLine); if (text.length) parts.push({ kind: 'text', key: `${rowKey}:text:${index}`, text }); }
      else if (part.type === 'thinking') { if (developer && part.thinking.length) parts.push({ kind: 'thinking', key: `${rowKey}:thinking:${index}`, text: part.thinking, streaming: streaming && index === content.length - 1 }); }
      else { const made = toolPart(part, `${rowKey}:tool:${index}`, committed); if (!natural && (made?.kind === 'artifact' || made?.kind === 'approval' || made?.kind === 'subagent') && made.entry) parts.push({ kind: 'tool', key: `${made.key}:step`, entry: made.entry }); if (made) parts.push(made); }
    }
    return parts;
  }

  const imagesOf = (content: readonly StreamPart[]): ImageContent[] => content.flatMap(part => part.type === 'toolCall'
    ? (results.get(part)?.content ?? []).filter((item): item is ImageContent => item.type === 'image') : []);

  // Pass 2: rows.
  const rows: R[] = [];
  for (const item of items) {
    if (item.card) { if (!item.card.required) rows.push({ key: item.key, type: 'card', card: item.card }); continue; }
    const message = item.message;
    if (!message) { if (developer) rows.push({ key: item.key, type: 'event', label: item.entry.kind }); continue; }
    if (message.role === 'system') {
      if (developer) rows.push({ key: item.key, type: 'system', text: typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join('\n') });
    } else if (message.role === 'toolResult') {
      // A result with its call is shown on the call's card. Only an unmatched failure gets its own row.
      if (!natural && message.isError && !matched.has(message)) rows.push({ key: item.key, type: 'orphan-result', message });
    } else if (message.role === 'user') rows.push({ key: item.key, type: 'user', message });
    else {
      const parts = partsOf(message.content, item.key, false, true), images = imagesOf(message.content);
      // Empty/tool-only rounds still contribute their native metadata to the answer.
      rows.push({ key: item.key, type: 'assistant', parts, ...(images.length ? { images } : {}), streaming: false, stopReason: message.stopReason, ...(message.errorMessage && !natural ? { errorMessage: message.errorMessage } : {}), text: textOf(parts), ...replyMeta(message), entryId: String(item.entry.id) });
    }
  }
  if (typeof taskId === 'number' && liveMessage) {
    const key = `assistant:${taskId}:${counts.get(taskId) ?? 0}`, content = streamParts(liveMessage['content']);
    const parts = partsOf(content, key, true, false), images = imagesOf(content);
    if (!natural || parts.length || images.length) rows.push({ key, type: 'assistant', parts, ...(images.length ? { images } : {}), streaming: true, text: textOf(parts) });
  }
  const merged = mergeTurns(rows).filter(row => row.type !== 'assistant' || row.parts.length || row.images?.length || row.stopReason === 'error' || row.stopReason === 'aborted' || row.streaming && !natural).map(row => row.type === 'assistant' && options.artifacts ? { ...row, parts: oneCardPerArtifact(row.parts) } : row);
  const last = merged[merged.length - 1];
  if (run && last?.type === 'assistant') merged[merged.length - 1] = { ...last, active: true };
  return { rows: merged, pinned, run, retry, ...(stageStatus !== undefined ? { stageStatus } : {}), compacting: Array.isArray(live?.['compactions']) && live['compactions'].length > 0 };
}

/** What a reply reports about the model round that wrote it, read from Pi's own message (each field only when it is there). */
export function replyMeta(message: AssistantMessage): { readonly timestamp?: number; readonly model?: { readonly provider: string; readonly modelId: string }; readonly durationMs?: number } {
  return {
    ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}),
    ...(typeof message.provider === 'string' && typeof message.model === 'string' ? { model: { provider: message.provider, modelId: message.model } } : {}),
    ...(typeof message.durationMs === 'number' ? { durationMs: message.durationMs } : {}),
  };
}

/**
 * Pi commits one assistant message per model round, so a turn with tool use is several messages in a row.
 * They read as one answer: merge consecutive assistant rows (unless one ended in an error or stop) so tool calls
 * group across rounds and the turn has a single copy action. The first row's key is kept, so identity is stable.
 */
function mergeTurns<Content>(rows: readonly Row<Content>[]): Row<Content>[] {
  const out: Row<Content>[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last?.type === 'assistant' && row.type === 'card' && row.card.inline) {
      out[out.length - 1] = { ...last, parts: [...last.parts, { kind: 'card', key: row.key, content: row.card.content }] };
    } else if (last?.type === 'assistant' && row.type === 'assistant' && !last.stopReason?.match(/^(error|aborted)$/)) {
      out[out.length - 1] = { key: last.key, type: 'assistant', parts: [...last.parts, ...row.parts], ...((last.images?.length || row.images?.length) ? { images: [...(last.images ?? []), ...(row.images ?? [])] } : {}), streaming: row.streaming,
        ...(row.stopReason ? { stopReason: row.stopReason } : {}), ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
        text: [last.text, row.text].filter(Boolean).join('\n\n'), ...(row.timestamp !== undefined ? { timestamp: row.timestamp } : {}), ...(row.model ? { model: row.model } : {}), ...(last.durationMs !== undefined || row.durationMs !== undefined ? { durationMs: (last.durationMs ?? 0) + (row.durationMs ?? 0) } : {}),
        ...(row.entryId !== undefined ? { entryId: row.entryId } : last.entryId !== undefined ? { entryId: last.entryId } : {}) };
    } else out.push(row);
  }
  return out;
}

/**
 * A turn that revises an artifact several times shows one card for it: the last version, at the place of the last step.
 * A running `present` of a file already shown takes over the title of its card.
 */
function oneCardPerArtifact<Content>(parts: readonly Part<Content>[]): Part<Content>[] {
  const idOf = (part: Part<Content>) => part.kind === 'artifact' ? part.artifact.id : undefined;
  const last = new Map<string, number>();
  for (const [index, part] of parts.entries()) { const id = idOf(part); if (id !== undefined) last.set(id, index); }
  const out: Part<Content>[] = [];
  for (const [index, part] of parts.entries()) {
    const id = idOf(part);
    if (id === undefined || last.get(id) === index) {
      if (part.kind === 'artifact' && part.artifact.state === 'presenting' && part.artifact.title === undefined && id !== undefined) {
        const earlier = parts.find(other => other.kind === 'artifact' && other.artifact.state === 'ready' && other.artifact.id === id);
        if (earlier?.kind === 'artifact') { out.push({ ...part, artifact: { ...part.artifact, title: earlier.artifact.title } }); continue; }
      }
      out.push(part);
    }
  }
  return out;
}

/** One step of an activity block: a default tool call or a stretch of reasoning. */
export type Step<Content = unknown> = { readonly kind: 'tool'; readonly key: string; readonly entry: ToolEntry<Content> }
  | { readonly kind: 'thinking'; readonly key: string; readonly text: string; readonly streaming: boolean };
/** An assistant turn is text parts and activity blocks: one block per uninterrupted run of steps. */
export type Segment<Content = unknown> = { readonly kind: 'part'; readonly part: Part<Content> } | { readonly kind: 'activity'; readonly key: string; readonly steps: readonly Step<Content>[] };
export function segments<Content>(parts: readonly Part<Content>[], groupTool: DeriveOptions['groupTool']): Segment<Content>[] {
  const out: Segment<Content>[] = [];
  let run: Step<Content>[] = [];
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
function safe(groupTool: NonNullable<DeriveOptions['groupTool']>, entry: ToolEntry<unknown>): boolean {
  try { return entry.result !== undefined && !entry.result.isError && groupTool(entry.call, entry.result) === true; } catch { return false; }
}

const LEAD_GAP_MS = 15 * 60_000;
const leads = new WeakMap<object, { readonly yes?: object; readonly no?: object }>();
const stamp = (row: Row<unknown>): number | undefined => row.type === 'user' ? row.message.timestamp : row.type === 'assistant' ? row.timestamp : undefined;
/**
 * `messageStyle="messaging"`: flags the first user or assistant row of each run (a change of side, or more than 15 minutes since the
 * last message) so only it gets a tail. A row keeps its identity while its flag does not change, so memoized rows stay still.
 */
export function markLeads<Content>(rows: readonly Row<Content>[]): readonly Row<Content>[] {
  return rows.map((row, at) => {
    if (row.type !== 'user' && row.type !== 'assistant') return row;
    const before = rows[at - 1], time = stamp(row), last = before && stamp(before);
    const lead = !before || before.type !== row.type || (time !== undefined && last !== undefined && time - last > LEAD_GAP_MS);
    if (row.lead === lead) return row;
    const cached = leads.get(row), hit = lead ? cached?.yes : cached?.no;
    if (hit) return hit as Row<Content>;
    const next = { ...row, lead } as Row<Content>;
    leads.set(row, { ...cached, [lead ? 'yes' : 'no']: next });
    return next;
  });
}

/**
 * The newest question or approval that waits for the person: committed (not still being generated), with no result yet and, for an
 * approval, no decision recorded. An approval whose decision is made is not waiting: the run carries on (or stops) by itself.
 */
export function waitingPart<Content>(rows: readonly Row<Content>[]): QuestionPart | ApprovalPart<Content> | undefined {
  for (let at = rows.length - 1; at >= 0; at--) {
    const row = rows[at];
    if (row?.type === 'assistant') for (const part of row.parts) if (waits(part)) return part;
  }
  return undefined;
}
/** Whether this one part waits for the person (the rule of `waitingPart`). */
export function waits<Content>(part: Part<Content>): part is QuestionPart | ApprovalPart<Content> {
  return (part.kind === 'question' || (part.kind === 'approval' && !part.decision)) && !part.live && !part.result;
}
/** Whether the conversation waits for the person to answer a question or decide an approval (`waitingPart`). */
export const waitingForAnswer = (rows: readonly Row<unknown>[]): boolean => waitingPart(rows) !== undefined;

/** `presentation="natural"`: whether the one "preparing" status shows. Any work (a run, a retry, a compaction) counts, except a confirmed stop with no run left; a question waiting for the person does not. */
export function preparing(input: { readonly natural: boolean; readonly waitingForAnswer: boolean; readonly run: unknown; readonly retry: unknown; readonly compacting: boolean; readonly stop: ChatSnapshot['stop'] }): boolean {
  const { natural, waitingForAnswer, run, retry, compacting, stop } = input;
  return natural && !waitingForAnswer && Boolean(run || retry || compacting) && !(stop === 'confirmed' && !run);
}

/** The words of run notices (toasts and system notifications). One table, so a surface localizes them in one place. */
export const defaultNoticeText = {
  /** What a waiting approval asks. */
  approve: (summary: string) => `Approve: ${summary}`,
  /** A failed run that reported no error message. */
  runFailed: 'The run failed',
  /** A finished run whose reply has no text. */
  finished: 'Finished',
};
export type NoticeText = typeof defaultNoticeText;

/** One line from a Markdown reply: its first non-empty line without Markdown marks, cut with an ellipsis. */
export function summaryOf(text: string, limit = 140): string {
  const line = text.split('\n').map(item => item.trim()).find(item => item && !/^(```|---+$)/.test(item)) ?? '';
  const plain = line.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

/**
 * What a notice says about the question or approval waiting for the person (`waitingPart`), if one waits. `question` reads the
 * question text from an `ask_user` call (the question item owns that grammar).
 */
export function pendingNotice(rows: readonly Row<unknown>[], question: (call: ToolCall) => string, text: NoticeText = defaultNoticeText): string | undefined {
  const part = waitingPart(rows);
  if (!part) return undefined;
  return part.kind === 'question' ? question(part.call) : text.approve(part.summary);
}

/** What a notice says about a run that just ended, from the conversation's rows; `undefined` when the person stopped it. */
export function finishNotice(rows: readonly Row<unknown>[], text: NoticeText = defaultNoticeText): { readonly kind: 'done' | 'error'; readonly summary: string } | undefined {
  const last = [...rows].reverse().find((row): row is Extract<Row<unknown>, { type: 'assistant' }> => row.type === 'assistant');
  if (last?.stopReason === 'aborted') return undefined;
  if (last?.stopReason === 'error') return { kind: 'error', summary: last.errorMessage ?? text.runFailed };
  return { kind: 'done', summary: summaryOf(last?.text ?? '') || text.finished };
}
