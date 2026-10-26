import { defineDoc } from '@earendil-works/pi-durable';
import type { Conversation, ConversationId, ConversationView, Cursor, EntryId, EntryRecord, Harness, SettledSubmissionRecord, SubmissionId, Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { withAbortSignal } from '@earendil-works/chord/context';
import { ASK_USER_TOOL, answerUserQuestion, askUserQuestionId } from './ask-user.js';
import type { AskUserAnswer } from './ask-user.js';

/**
 * A shared room on pi-durable: people and agents in one session that never runs a model. Every entry is a passive write
 * keyed by a namespaced `requestId` (CH-20); `roomView` is the only reader (CH-24); `wakeFor` alone decides which agent
 * runs (CH-22); an agent posts only through an open wake (CH-23). The agent side, `createRoomTurn`, runs the woken agent
 * in its own home and settles the wake, lifted from the WhatsApp channel gateway (`examples/whatsapp/channels.ts`).
 * Membership, roles and the doors stay with the host.
 */
export const ROOM = Object.freeze({
  schema: 'boring.room', version: 1,
  /** Agents one person's message may wake by mention. */
  maxMentions: 2,
  /** Agent turns in one `agents:<a>:<b>` conversation per cause. */
  maxAgentTurns: 6,
  /** A wake still open this long is resent, doubling each time, at most `maxResends` times. */
  resendAfterMs: 120_000, maxResends: 5,
  /** The room's own actor: it closes a wake its agent never settled. */
  platform: 'platform:room',
  unanswered: 'Je n\'ai pas pu répondre. Réessayez.',
  removed: 'message supprimé',
});

/** `agent:<name>` ids are agents; `platform:<name>` ids are the platform; anything else is a person. */
export const isAgent = (id: string): boolean => id.startsWith('agent:');
const isPerson = (id: string): boolean => !isAgent(id) && !id.startsWith('platform:');

export type RoomStep = { label: string; status: string };
/** The `data` of each room entry kind. Every entry names its `author`. */
export type RoomEntryData = {
  'room.message': { author: string; via?: string; for?: string; text: string; mentions: string[]; replyTo?: number; attachments: { path: string }[]; steps: RoomStep[] };
  /** The target stays stored and reads as « message supprimé » (CH-6). */
  'room.removed': { author: string; target: number };
  /** A request first shown here; its state lives in the cards the host passes to `roomView`. */
  'room.card': { author: string; requestId: string };
  'room.pin': { author: string; title: string; line: string; anchor: string };
  /** An agent's `ask_user`, as the room shows it. */
  'room.question': { author: string; callId: string; prompt: string; options: string[]; allowFreeText: boolean };
  'room.action': { author: string; requestId: string; actionId: string };
  /** « X joined » and « X left » only; never written by an agent. */
  'room.system': { author: string; line: string };
};
export type RoomKind = keyof RoomEntryData;
export const ROOM_KINDS = Object.freeze(['room.message', 'room.removed', 'room.card', 'room.pin', 'room.question', 'room.action', 'room.system'] as const satisfies readonly RoomKind[]);
export type RoomEntry = { [K in RoomKind]: { readonly id: number; readonly kind: K; readonly data: RoomEntryData[K] } }[RoomKind];
export type RoomCard = { version: number; title: string; state: string; line: string; since: number; actions: string[] };

/** Room entries of a native transcript, in entry order; other entries are skipped. */
export function roomEntries(records: readonly EntryRecord[]): RoomEntry[] {
  return records.flatMap(record => (ROOM_KINDS as readonly string[]).includes(record.kind) && record.data && typeof record.data === 'object'
    ? [{ id: Number(record.id), kind: record.kind, data: record.data } as RoomEntry] : []);
}

// ─── The view ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoomItem =
  | { kind: 'message'; id: number; author: string; via?: string; for?: string; text: string; mentions: string[]; replyTo?: number; attachments: { path: string }[]; steps: RoomStep[]; mine: boolean; removed: boolean }
  | { kind: 'card'; id: number; author: string; requestId: string; card: RoomCard | null }
  | { kind: 'pin'; id: number; author: string; title: string; line: string; anchor: string; mine: boolean }
  | { kind: 'question'; id: number; author: string; callId: string; prompt: string; options: string[]; allowFreeText: boolean; answered: boolean }
  | { kind: 'system'; id: number; line: string };
export type RoomView = { items: RoomItem[]; cursor: number | null };

/**
 * The one pure fold from entries to what `viewer` sees. History, `channel_read`, the socket's resume and the tests all
 * use it, so replaying the same entries gives the same view, byte for byte. Keys are written in a fixed order and absent
 * optional fields are left out, so `JSON.stringify` of the view is stable.
 */
export function roomView(entries: readonly RoomEntry[], cards: Readonly<Record<string, RoomCard>>, viewer: { readonly id: string }): RoomView {
  const removed = new Set<number>();
  const answered = new Set<number>();
  for (const entry of entries) {
    if (entry.kind === 'room.removed') removed.add(entry.data.target);
    if (entry.kind === 'room.message' && entry.data.replyTo !== undefined) answered.add(entry.data.replyTo);
  }
  const items: RoomItem[] = [];
  for (const { id, kind, data } of entries) {
    if (kind === 'room.message') {
      const gone = removed.has(id);
      items.push({
        kind: 'message', id, author: data.author, ...(data.via ? { via: data.via } : {}), ...(data.for ? { for: data.for } : {}),
        text: gone ? ROOM.removed : data.text, mentions: [...data.mentions], ...(data.replyTo !== undefined ? { replyTo: data.replyTo } : {}),
        attachments: gone ? [] : data.attachments.map(({ path }) => ({ path })), steps: gone ? [] : data.steps.map(({ label, status }) => ({ label, status })),
        mine: data.author === viewer.id || data.via === viewer.id, removed: gone,
      });
    } else if (kind === 'room.card') {
      const card = cards[data.requestId];
      items.push({ kind: 'card', id, author: data.author, requestId: data.requestId,
        card: card ? { version: card.version, title: card.title, state: card.state, line: card.line, since: card.since, actions: [...card.actions] } : null });
    } else if (kind === 'room.pin') {
      items.push({ kind: 'pin', id, author: data.author, title: data.title, line: data.line, anchor: data.anchor, mine: data.author === viewer.id });
    } else if (kind === 'room.question') {
      items.push({ kind: 'question', id, author: data.author, callId: data.callId, prompt: data.prompt, options: [...data.options], allowFreeText: data.allowFreeText, answered: answered.has(id) });
    } else if (kind === 'room.system') {
      items.push({ kind: 'system', id, line: data.line });
    }
  }
  return { items, cursor: entries.at(-1)?.id ?? null };
}

// ─── Who answers ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The 1:1 conversation of two agents; the same name whichever opens it. */
export function agentsConversation(a: string, b: string): string {
  const names = [a, b].map(id => { if (!isAgent(id) || id.slice(6).includes(':') || id.length === 6) throw new Error(`Not an agent id: ${id}`); return id.slice(6); }).sort();
  return `agents:${names[0]}:${names[1]}`;
}
const agentsOf = (conversation: string): [string, string] | undefined => {
  const parts = conversation.split(':');
  return parts.length === 3 && parts[0] === 'agents' ? [`agent:${parts[1]}`, `agent:${parts[2]}`] : undefined;
};

export type RoomContext = {
  /** `main`, `admin` or `agents:<a>:<b>`. */
  readonly conversation: string;
  /** People in the room (the directory's projection) and the agents provisioned in it. */
  readonly people: readonly string[];
  readonly agents: readonly string[];
  /** The entry this one points to: a message's `replyTo`, or an action's card. */
  readonly target?: RoomEntry;
  /** Agent turns this 1:1 already used for the current cause. */
  readonly turns?: number;
};
export type RoomDecision =
  | { readonly kind: 'wake'; readonly agent: string; readonly conversation: string }
  /** Not a new turn: the reply answers the agent's pending `ask_user`. */
  | { readonly kind: 'answer'; readonly agent: string; readonly callId: string }
  /** The 1:1 hit its cap and closes; its opener tells the person in `main`. */
  | { readonly kind: 'capped'; readonly conversation: string };

/**
 * Which agents a committed entry wakes (CH-22). A person's mention wakes at most two agents, a reply wakes the agent
 * replied to, a reply to a question answers it, and an unaddressed message wakes the PM only when its sender is the
 * only person in the room. An agent never wakes another agent in `main`; in `agents:<a>:<b>` each message wakes the
 * other one, up to six turns. A person's card action wakes the card's agent; platform card changes wake nobody.
 */
export function wakeFor(entry: RoomEntry, room: RoomContext): RoomDecision[] {
  const { author } = entry.data;
  const wake = (agent: string): RoomDecision => ({ kind: 'wake', agent, conversation: room.conversation });
  if (isAgent(author)) {
    const pair = entry.kind === 'room.message' ? agentsOf(room.conversation) : undefined;
    if (!pair?.includes(author)) return [];
    if ((room.turns ?? 0) + 1 >= ROOM.maxAgentTurns) return [{ kind: 'capped', conversation: room.conversation }];
    return [wake(pair[0] === author ? pair[1] : pair[0])];
  }
  if (!isPerson(author)) return [];
  const target = room.target;
  if (entry.kind === 'room.action') return target?.kind === 'room.card' && isAgent(target.data.author) && room.agents.includes(target.data.author) ? [wake(target.data.author)] : [];
  if (entry.kind !== 'room.message') return [];
  if (target?.kind === 'room.question') return [{ kind: 'answer', agent: target.data.author, callId: target.data.callId }];
  const agents = entry.data.mentions.filter(id => room.agents.includes(id)).slice(0, ROOM.maxMentions);
  if (target && (target.kind === 'room.message' || target.kind === 'room.card') && room.agents.includes(target.data.author)) agents.push(target.data.author);
  const woken = [...new Set(agents)];
  if (woken.length) return woken.map(wake);
  return room.people.length === 1 && room.people[0] === author && room.agents.includes('agent:pm') ? [wake('agent:pm')] : [];
}

// ─── The room ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** An open wake: the WhatsApp outbox pattern. `cause` is the person's entry that started it; `id` starts with the id
 * of the entry that woke the agent, so the wake's conversation is that entry's. */
export type RoomWake = { id: string; agent: string; conversation: string; cause: number; turns: number; attempts: number; due: number };
/** Conversation names to native ids, and each card's first entry (an action's target). */
const RoomIndex = defineDoc<{ conversations: Record<string, number>; cards: Record<string, number> }>({ kind: 'boring.room.index', version: 1, scope: 'session', initial: () => ({ conversations: {}, cards: {} }) });
const RoomWakes = defineDoc<{ open: RoomWake[] }>({ kind: 'boring.room.wakes', version: 1, scope: 'session', initial: () => ({ open: [] }) });

export type RoomDraft = { [K in RoomKind]: { readonly requestId: string; readonly kind: K; readonly data: RoomEntryData[K] } }[RoomKind];
export type RoomWrite = { readonly entry: RoomEntry; readonly duplicate: boolean; readonly decisions: readonly RoomDecision[]; readonly wakes: readonly RoomWake[] };
export type RoomRefusal = { readonly refused: 'no-open-wake' };
export type RoomReply = { readonly text: string; readonly steps?: readonly RoomStep[] };
export type RoomQuestionDraft = { readonly callId: string; readonly prompt: string; readonly options: readonly string[]; readonly allowFreeText: boolean };

export interface Room {
  /** The native conversation of a room conversation name, created on first use. */
  readonly conversation: (name: string) => Promise<ConversationId>;
  /**
   * Write one entry: the entry, its native passive-write record (the `requestId` dedupe record) and the wakes it causes
   * land in one commit or not at all (B2). The same `requestId` again returns the first entry and wakes nobody.
   */
  readonly write: (name: string, draft: RoomDraft, members: Pick<RoomContext, 'people' | 'agents'>) => Promise<RoomWrite>;
  /** The agent's reply on its open wake, keyed `wake:<id>`, closing it. A repeat returns the first message; without a wake, nothing is written (CH-23). */
  readonly settle: (agent: string, wakeId: string, reply: RoomReply) => Promise<RoomWrite | RoomRefusal>;
  /** The agent's `ask_user` on its open wake, keyed `q:<callId>`. */
  readonly question: (agent: string, wakeId: string, question: RoomQuestionDraft) => Promise<RoomWrite | RoomRefusal>;
  /**
   * The alarm's step. Due wakes are returned to resend, with backoff. A wake past its last resend is closed by the room
   * itself, as `platform:room`, with one message keyed `wake:<id>`, so a late reply can never add a second one.
   */
  readonly resend: () => Promise<{ readonly resend: readonly RoomWake[]; readonly closed: readonly RoomWake[]; readonly next: number | null }>;
  readonly wakes: () => Promise<RoomWake[]>;
  /** The room entries of a conversation after the `after` cursor, oldest first. */
  readonly entries: (name: string, after?: number) => Promise<RoomEntry[]>;
}

type Decide = (tx: Tx, entry: RoomEntry, target: RoomEntry | undefined) => Promise<{ decisions: RoomDecision[]; wakes: RoomWake[] }>;
const REFUSED: RoomRefusal = Object.freeze({ refused: 'no-open-wake' });
const copyWake = (wake: RoomWake): RoomWake => ({ ...wake });

/** The room over one Harness that never runs a model. Membership, roles and rates are the host's, before it calls. */
export function createRoom(options: { readonly harness: Harness; readonly context: Context; readonly now?: () => number }): Room {
  const { harness, context } = options;
  const now = options.now ?? Date.now;

  const conversation = (name: string): Promise<ConversationId> => harness.commit(async tx => {
    const index = await tx.doc(RoomIndex);
    const known = index.conversations[name];
    if (known !== undefined) return known as ConversationId;
    const created = await tx.createConversation({ ownership: { kind: 'ownerless' } });
    index.conversations[name] = created.id;
    return created.id;
  }, context);

  /** One commit: table reads first, then the entry and its native write record, then the documents. */
  const commitEntry = (conversationId: ConversationId, draft: RoomDraft, decide: Decide, admit?: (open: readonly RoomWake[]) => boolean): Promise<RoomWrite | RoomRefusal> => harness.commit(async tx => {
    const known = await tx.submissionByRequest(conversationId, draft.requestId);
    if (known?.status === 'done') return { entry: roomEntries([(await tx.entry(known.entry))!])[0]!, duplicate: true, decisions: [], wakes: [] };
    const targetId = draft.kind === 'room.message' ? draft.data.replyTo : draft.kind === 'room.action' ? (await tx.doc(RoomIndex)).cards[draft.data.requestId] : undefined;
    const targetRecord = targetId === undefined ? undefined : await tx.entry(targetId as EntryId);
    const target = targetRecord?.conversationId === conversationId ? roomEntries([targetRecord])[0] : undefined;
    if (admit && !admit((await tx.doc(RoomWakes)).open)) return REFUSED;
    const record = await tx.appendEntry(conversationId, { kind: draft.kind, data: draft.data });
    // A display-only write is `done` at once, as Pi's own admission would place it; `Conversation.submit` sees this record.
    await tx.createSubmission({ type: 'write', conversationId, requestId: draft.requestId, status: 'done', entry: record.id });
    const entry = roomEntries([record])[0]!;
    if (draft.kind === 'room.card') (await tx.doc(RoomIndex)).cards[draft.data.requestId] ??= entry.id;
    const { decisions, wakes } = await decide(tx, entry, target);
    if (wakes.length) (await tx.doc(RoomWakes)).open.push(...wakes);
    return { entry, duplicate: false, decisions, wakes: wakes.map(copyWake) };
  }, context);

  const wakesOf = (entry: RoomEntry, name: string, decisions: readonly RoomDecision[], turns: number, cause: number): RoomWake[] => decisions.flatMap(decision => decision.kind !== 'wake' ? []
    : [{ id: `${entry.id}:${decision.agent}`, agent: decision.agent, conversation: name, cause, turns: name.startsWith('agents:') ? turns + 1 : 0, attempts: 0, due: now() + ROOM.resendAfterMs }]);

  /** Write on the open wake of `agent`. `close` ends it; a reply in a 1:1 carries the wake's cause and turns forward. */
  async function onWake(agent: string, wakeId: string, draft: RoomDraft, close: boolean): Promise<RoomWrite | RoomRefusal> {
    const cause = /^(\d+):agent:[^:]+$/.exec(wakeId)?.[1];
    const conversationId = cause === undefined ? undefined : await harness.commit(async tx => (await tx.entry(Number(cause) as EntryId))?.conversationId, context);
    if (conversationId === undefined) return REFUSED;
    const mine = (wake: RoomWake) => wake.id === wakeId && wake.agent === agent;
    // Without an open wake only a repeat of an earlier write succeeds; `admit` refuses a new entry.
    return commitEntry(conversationId, draft, async (tx, entry) => {
      const wakes = await tx.doc(RoomWakes);
      const current = wakes.open.find(mine);
      if (!close || !current) return { decisions: [], wakes: [] };
      wakes.open.splice(wakes.open.indexOf(current), 1);
      const decisions = wakeFor(entry, { conversation: current.conversation, people: [], agents: [], turns: current.turns });
      return { decisions, wakes: wakesOf(entry, current.conversation, decisions, current.turns, current.cause) };
    }, open => open.some(mine));
  }

  const openWakes = async () => ((await harness.snapshot(RoomWakes, context))?.open ?? []).map(copyWake);

  return {
    conversation,
    write: async (name, draft, members) => commitEntry(await conversation(name), draft, async (_tx, entry, target) => {
      const decisions = wakeFor(entry, { conversation: name, people: members.people, agents: members.agents, ...(target ? { target } : {}) });
      return { decisions, wakes: wakesOf(entry, name, decisions, 0, entry.id) };
    }) as Promise<RoomWrite>,
    settle: (agent, wakeId, reply) => onWake(agent, wakeId, {
      requestId: `wake:${wakeId}`, kind: 'room.message',
      data: { author: agent, text: reply.text, mentions: [], attachments: [], steps: (reply.steps ?? []).map(({ label, status }) => ({ label, status })) },
    }, true),
    question: (agent, wakeId, question) => onWake(agent, wakeId, {
      requestId: `q:${question.callId}`, kind: 'room.question',
      data: { author: agent, callId: question.callId, prompt: question.prompt, options: [...question.options], allowFreeText: question.allowFreeText },
    }, false),
    resend: async () => {
      const at = now();
      const { resend, closed } = await harness.commit(async tx => {
        const wakes = await tx.doc(RoomWakes);
        const resend: RoomWake[] = []; const closed: RoomWake[] = [];
        for (const wake of wakes.open.filter(wake => wake.due <= at)) {
          if (wake.attempts >= ROOM.maxResends) { closed.push(copyWake(wake)); continue; }
          wake.attempts += 1;
          wake.due = at + ROOM.resendAfterMs * 2 ** wake.attempts;
          resend.push(copyWake(wake));
        }
        return { resend, closed };
      }, context);
      // The room's own line, keyed like the agent's reply: whichever lands first is the only message.
      for (const wake of closed) await commitEntry(await conversation(wake.conversation), {
        requestId: `wake:${wake.id}`, kind: 'room.message',
        data: { author: ROOM.platform, for: wake.agent, text: ROOM.unanswered, mentions: [], attachments: [], steps: [] },
      }, async tx => { const wakes = await tx.doc(RoomWakes); wakes.open = wakes.open.filter(item => item.id !== wake.id); return { decisions: [], wakes: [] }; });
      const open = await openWakes();
      return { resend, closed, next: open.length ? Math.min(...open.map(wake => wake.due)) : null };
    },
    wakes: openWakes,
    entries: async (name, after) => {
      const handle = await harness.conversation(await conversation(name), context);
      const records: EntryRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await handle!.entries({ order: 'ascending', ...(after === undefined ? {} : { minEntryId: (after + 1) as EntryId }) }, 200, cursor, context);
        records.push(...page.items);
        cursor = page.next;
      } while (cursor !== undefined);
      return roomEntries(records);
    },
  };
}

// ─── The agent's side ──────────────────────────────────────────────────────────────────────────────────────────────

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
      pending.set(part.id, { callId: askUserQuestionId(entry.id, part.id), prompt: args.question, options, allowFreeText: args.allowFreeText !== false || options.length === 0 });
    }
  }
  return [...pending.values()];
}

/** The visible text of the assistant entry that answered a submission. */
function answerText(entry: EntryRecord | undefined): string {
  return (entry?.model ?? []).flatMap(message => message.role === 'assistant' ? message.content : [])
    .flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n').trim();
}

/** Live frames of a wake's run. The room relays them and never stores them: the settled message is the truth (CH-24). */
export type RoomFrame = { readonly type: 'text'; readonly text: string } | { readonly type: 'step'; readonly label: string; readonly status: 'running' | 'done' };

const framesOf = (entries: readonly EntryRecord[]): RoomFrame[] => entries.flatMap(entry => (entry.model ?? []).flatMap((message): RoomFrame[] => {
  if (message.role === 'toolResult') return [{ type: 'step', label: message.toolName, status: 'done' }];
  if (message.role !== 'assistant') return [];
  return message.content.flatMap((part): RoomFrame[] => part.type === 'text' && part.text ? [{ type: 'text', text: part.text }] : part.type === 'toolCall' ? [{ type: 'step', label: part.name, status: 'running' }] : []);
}));

/** The agent's door into the room, bound to the agent by its host: the agent id is never an argument. */
export interface RoomPort {
  readonly settle: (wakeId: string, reply: RoomReply) => Promise<unknown>;
  readonly stream?: (wakeId: string, frames: readonly RoomFrame[]) => Promise<unknown>;
  readonly question?: (wakeId: string, question: PendingQuestion) => Promise<unknown>;
}

export interface RoomTurn {
  /**
   * `AgentPort.wake`: submit the wake's input as `room:<wakeId>` and settle it through the port in the background.
   * Resolves once the input is durably admitted. Pi deduplicates the `requestId`, so a resent wake starts nothing: once
   * its run is done it settles again with the same answer, and the room's `wake:<id>` record absorbs the repeat.
   */
  readonly wake: (wake: { readonly wakeId: string; readonly input: string }) => Promise<void>;
  /** The room's answer to a `room.question`, into this conversation's pending `ask_user`. */
  readonly answer: (callId: string, text: string) => Promise<AskUserAnswer>;
  /** Settle every wake admitted before a restart. Call once after `harness.resume()`. */
  readonly start: () => Promise<void>;
  /** Stop waiting. Owed settles stay durable for the next `start`. */
  readonly close: () => Promise<void>;
}

/** Wakes owed a settle: written before the input is submitted, removed after the room took the reply. */
type Owed = { wakeId: string; input: string; asked: string[] };
const Turns = defineDoc<{ owed: Owed[] }>({ kind: 'boring.room.turns', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ owed: [] }) });

/** The agent's side of a room, over its own conversation in its own home. Delivery to the port is at least once. */
export function createRoomTurn(options: { readonly conversation: Conversation; readonly context: Context; readonly port: RoomPort; readonly onError?: (error: unknown) => void }): RoomTurn {
  const { conversation, port } = options;
  const closing = new AbortController();
  const context = withAbortSignal(closing.signal, options.context);
  const report = (error: unknown) => { if (!closing.signal.aborted) try { options.onError?.(error); } catch { /* observers never break delivery */ } };
  const delivering = new Map<string, Promise<void>>();
  const requestId = (wakeId: string) => `room:${wakeId}`;
  const owed = (wakeId: string) => conversation.commit(async tx => {
    const item = (await tx.doc(Turns, conversation.id)).owed.find(item => item.wakeId === wakeId);
    return item && { ...item, asked: [...item.asked] };
  }, context);
  const update = (wakeId: string, change: (items: Owed[], index: number) => void) => conversation.commit(async tx => {
    const items = (await tx.doc(Turns, conversation.id)).owed;
    const index = items.findIndex(item => item.wakeId === wakeId);
    if (index >= 0) change(items, index);
  }, context);

  /**
   * Relay the run's frames and each new `ask_user` while the wake is open. A queued wake has no entry yet: its input
   * lands when the earlier run is done, so follow from the start and learn `from` the first time its entry exists.
   * Nothing is relayed before then, and never anything at or below the input's own entry (that is another wake's run).
   * Text is relayed as growth: per entry the text length and step count already sent are remembered, only the rest goes.
   * The partial reply of the run in flight lives in the `pi.live` document, not in the entries: when that run is this
   * wake's (its inputs hold our submission), its text grows through the same path under `live`, and the settled entry
   * is seeded from it so nothing is sent twice.
   */
  async function follow(wakeId: string, known?: EntryId): Promise<() => Promise<void>> {
    const watch = await conversation.watch(context);
    const sent = new Map<number, { text: number; steps: number }>();
    let from = known;
    let submission: SubmissionId | undefined;
    let live = '';
    let queue = Promise.resolve();
    // Port calls are chained off the watch so a slow room never holds native frames.
    const relay = async (view: ConversationView) => {
      queue = queue.then(async () => {
        if (from === undefined || submission === undefined) {
          const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, requestId(wakeId)), context);
          submission = record?.id;
          from ??= record?.entry;
        }
        if (from === undefined) return;
        const own = view.entries.filter(entry => entry.id > from!);
        const frames: RoomFrame[] = [];
        for (const entry of own) {
          const all = framesOf([entry]);
          const text = all.flatMap(frame => frame.type === 'text' ? [frame.text] : []).join('\n\n');
          // The first settled text of this run starts after what its live partial already sent.
          if (!sent.has(entry.id) && text) { sent.set(entry.id, { text: text.startsWith(live) ? live.length : 0, steps: 0 }); live = ''; }
          const before = sent.get(entry.id) ?? { text: 0, steps: 0 };
          const steps = all.filter(frame => frame.type === 'step');
          // Steps first: a tool call that began after the text belongs after it, but a lost order costs only polish.
          frames.push(...steps.slice(before.steps));
          if (text.length > before.text) frames.push({ type: 'text', text: text.slice(before.text) });
          sent.set(entry.id, { text: Math.max(before.text, text.length), steps: Math.max(before.steps, steps.length) });
        }
        const partial = view.docs['pi.live'] as { run?: { inputs?: readonly unknown[] }; generation?: { message?: { role?: string; content?: readonly { type: string; text?: string }[] } } } | undefined;
        const message = partial?.generation?.message;
        if (submission !== undefined && partial?.run?.inputs?.includes(submission) && message?.role === 'assistant') {
          const text = (message.content ?? []).flatMap(part => part.type === 'text' && part.text ? [part.text] : []).join('\n\n');
          if (text.length > live.length && text.startsWith(live)) { frames.push({ type: 'text', text: text.slice(live.length) }); live = text; }
        }
        const questions = pendingQuestions(own);
        if (frames.length && port.stream) await port.stream(wakeId, frames);
        if (!port.question) return;
        const asked = (await owed(wakeId))?.asked ?? [];
        for (const question of questions.filter(question => !asked.includes(question.callId))) {
          await port.question(wakeId, question);
          // Asking cannot share the native commit: a crash before this acknowledgement repeats it, and `q:<callId>` absorbs that.
          await update(wakeId, (items, index) => { if (!items[index]!.asked.includes(question.callId)) items[index]!.asked.push(question.callId); });
        }
      }).catch(report);
    };
    await relay(watch.value);
    watch.start(relay);
    return async () => { await watch.stop(); await queue; };
  }

  function deliver(wakeId: string): Promise<void> {
    const existing = delivering.get(wakeId);
    if (existing) return existing;
    const run = (async () => {
      const item = await owed(wakeId);
      if (!item) return;
      // The same `requestId` returns the first submission: a resend or a restart never starts a second run.
      const submission = await conversation.submit({ type: 'input', requestId: requestId(wakeId), content: item.input, whenBusy: 'followUp' }, context);
      const placed = await conversation.commit(tx => tx.submissionByRequest(conversation.id, requestId(wakeId)), context);
      // A queued submission has no entry yet; it is followed all the same (see `follow`).
      const stop = placed?.status === 'done' || placed?.status === 'unanswered' ? async () => {} : await follow(wakeId, placed?.entry);
      let record: SettledSubmissionRecord;
      try { record = await submission.wait(context); } finally { await stop(); }
      // An unanswered run is closed with the room's own line, never dropped: left open it would only wait for its resends.
      if (record.type === 'input' && record.status === 'done') {
        const entry = (await conversation.entries({ minEntryId: record.answer, maxEntryId: record.answer }, 1, undefined, context)).items[0];
        await port.settle(wakeId, { text: answerText(entry) });
      } else if (record.type === 'input' && record.status === 'unanswered') await port.settle(wakeId, { text: ROOM.unanswered });
      await update(wakeId, (items, index) => { items.splice(index, 1); });
    })().catch(report).finally(() => delivering.delete(wakeId));
    delivering.set(wakeId, run);
    return run;
  }

  return {
    wake: async ({ wakeId, input }) => {
      await conversation.commit(async tx => {
        const items = (await tx.doc(Turns, conversation.id)).owed;
        if (!items.some(item => item.wakeId === wakeId)) items.push({ wakeId, input, asked: [] });
      }, context);
      // Admitted before resolving, so the room may count the wake delivered.
      await conversation.submit({ type: 'input', requestId: requestId(wakeId), content: input, whenBusy: 'followUp' }, context);
      void deliver(wakeId);
    },
    answer: (callId, text) => answerUserQuestion(conversation, callId, text, context),
    start: async () => {
      const items = await conversation.commit(async tx => (await tx.doc(Turns, conversation.id)).owed.map(item => item.wakeId), context);
      for (const wakeId of items) void deliver(wakeId);
    },
    close: async () => {
      closing.abort();
      await Promise.allSettled([...delivering.values()]);
    },
  };
}
