import { defineDoc } from '@earendil-works/pi-durable';
import type { CommitPublication, Conversation, ConversationId, ConversationInit, Cursor, EntryId, EntryRecord, Harness } from '@earendil-works/pi-durable';
import type { Message } from '@earendil-works/pi-ai';
import type { Context } from '@earendil-works/chord';
import { RequestGuardError, hasJsonContentType, readJsonBody } from '@hachej/boring-files/request-guard';
import { MENTION_FILE_PREFIX } from './mentions.js';

/**
 * What a host's conversation list needs that Pi does not keep: a title, when it was created and last active, a preview of the
 * last message, whether it is archived or deleted, and which host owner it belongs to. One native conversation document per
 * conversation, written through the public document API; there is no second store. A conversation without this document (or
 * with an empty owner, such as a native fork made outside this module) is not managed and never listed.
 */
export type ConversationMetadata = {
  /** The host's owner key (a person, a team, an agent). Empty: not managed by this module. */
  owner: string;
  /** Set explicitly, or derived once from the first user message; durable afterwards. */
  title: string | null;
  createdAt: number;
  /** Last activity: the last user or assistant message (or creation, rename is not activity). */
  updatedAt: number;
  /** A bounded preview of the last user or assistant message. */
  lastMessage: string | null;
  archived: boolean;
  /** Pi cannot delete a conversation: a deleted one is hidden by this durable mark; its records stay in the session storage. */
  deletedAt: number | null;
};

/** The native document. `fork: 'initial'`: a fork made by `fork()` gets its own metadata in the creating commit; any other fork starts unmanaged. */
export const conversationMetadata = defineDoc<ConversationMetadata>({
  kind: 'boring.conversation.metadata', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ owner: '', title: null, createdAt: 0, updatedAt: 0, lastMessage: null, archived: false, deletedAt: null }),
});

/** One row of a conversation list. */
export interface ConversationSummary {
  readonly id: ConversationId;
  readonly title: string | null;
  readonly lastMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived: boolean;
}

export interface ConversationListQuery {
  readonly owner: string;
  /** `false` (default): active ones; `true`: archived ones; `'all'`: both. Deleted ones never. */
  readonly archived?: boolean | 'all';
  /** Case-insensitive substring of the title or the last message. */
  readonly query?: string;
  /** Default 50, at most 200. */
  readonly limit?: number;
  /** The `next` of the previous page. */
  readonly cursor?: string;
}

export interface ConversationsOptions {
  readonly harness: Harness;
  /** Long-lived context for the metadata writes that follow turns. */
  readonly context: Context;
  readonly now?: () => number;
  /** Longest derived title (default 80 characters). */
  readonly titleLength?: number;
  /** Longest last-message preview (default 160 characters). */
  readonly previewLength?: number;
  /** A metadata write after a turn failed (the turn itself is unaffected). */
  readonly onError?: (error: unknown) => void;
}

export interface Conversations {
  /**
   * Create a managed conversation; its metadata is written in the creating commit. `start` creates the native conversation with
   * the host's agent (pass `init` on, for example `definition.createConversation(harness, context, { init })`); the default is
   * an ownerless `harness.createConversation`.
   */
  readonly create: (owner: string, options?: { readonly title?: string; readonly start?: (init: ConversationInit) => Promise<Conversation> }) => Promise<Conversation>;
  /**
   * Manage an existing conversation (migration). Title and preview are derived once from its history (bounded scan) unless
   * given. Returns `undefined` when the conversation does not exist or another owner already manages it.
   */
  readonly adopt: (id: ConversationId, owner: string, options?: { readonly title?: string; readonly createdAt?: number; readonly updatedAt?: number }) => Promise<ConversationSummary | undefined>;
  /** The summary when `owner` manages the conversation and it is not deleted. */
  readonly get: (owner: string, id: ConversationId) => Promise<ConversationSummary | undefined>;
  /** The native handle under the same condition as `get`. */
  readonly open: (owner: string, id: ConversationId) => Promise<Conversation | undefined>;
  /** Newest activity first. One `scanConversations` pass plus one metadata read per conversation; no transcript is read. */
  readonly list: (query: ConversationListQuery) => Promise<{ readonly items: readonly ConversationSummary[]; readonly next?: string }>;
  readonly rename: (owner: string, id: ConversationId, title: string) => Promise<ConversationSummary | undefined>;
  readonly archive: (owner: string, id: ConversationId, archived?: boolean) => Promise<ConversationSummary | undefined>;
  /** Stops the conversation's ordinary work, then marks it deleted (Pi has no delete). `false` when not found. */
  readonly delete: (owner: string, id: ConversationId) => Promise<boolean>;
  /** Native `Conversation.fork(at)`: a new managed conversation with the history up to and including entry `at`, titled "<title> (fork)". */
  readonly fork: (owner: string, id: ConversationId, at: EntryId, options?: { readonly title?: string }) => Promise<Conversation | undefined>;
  /** Wait for the metadata writes of turns already committed. */
  readonly flush: () => Promise<void>;
  /** Stop observing commits (after `flush`). Never closes the Harness. */
  readonly dispose: () => Promise<void>;
}

const managed = (meta: Readonly<ConversationMetadata> | undefined, owner?: string): meta is Readonly<ConversationMetadata> =>
  meta !== undefined && meta.owner !== '' && meta.deletedAt === null && (owner === undefined || meta.owner === owner);
const clip = (text: string, max: number): string => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };

/** The visible text of a user or assistant message: text parts only, never the `<file>` blocks mentions add. */
export function messageText(message: Message): string | undefined {
  if (message.role === 'user') {
    const text = typeof message.content === 'string' ? message.content
      : message.content.map(part => part.type === 'text' && !part.text.startsWith(MENTION_FILE_PREFIX) ? part.text : '').join(' ');
    return text.trim() ? text : undefined;
  }
  if (message.role === 'assistant') {
    const text = message.content.map(part => part.type === 'text' ? part.text : '').join(' ');
    return text.trim() ? text : undefined;
  }
  return undefined;
}

function summary(id: ConversationId, meta: Readonly<ConversationMetadata>): ConversationSummary {
  return { id, title: meta.title, lastMessage: meta.lastMessage, createdAt: meta.createdAt, updatedAt: meta.updatedAt, archived: meta.archived };
}

export function createConversations(options: ConversationsOptions): Conversations {
  const { harness, context } = options;
  const now = options.now ?? Date.now;
  const titleLength = options.titleLength ?? 80, previewLength = options.previewLength ?? 160;
  const read = (id: ConversationId) => harness.snapshot(conversationMetadata, id, context);
  // Checked before the commit (so no document is created for a conversation this module does not manage) and again inside it.
  const write = async <T>(id: ConversationId, owner: string, change: (meta: ConversationMetadata) => T): Promise<T | undefined> => {
    if (!managed(await read(id), owner)) return undefined;
    return harness.commit(async tx => {
      const meta = await tx.doc(conversationMetadata, id);
      return managed(meta, owner) ? change(meta) : undefined;
    }, context);
  };

  // ---- After a turn: the commits that append user or assistant messages update the metadata of managed conversations.
  // The listener only collects (it may not call Session APIs); one queued writer applies the latest of each conversation.
  type Pending = { firstUser?: string; last?: string; at: number };
  const pending = new Map<ConversationId, Pending>();
  let chain: Promise<void> = Promise.resolve(), scheduled = false;
  const apply = async (id: ConversationId, item: Pending): Promise<void> => {
    const meta = await read(id);
    if (!managed(meta)) return;
    await harness.commit(async tx => {
      const draft = await tx.doc(conversationMetadata, id);
      if (!managed(draft)) return;
      draft.updatedAt = Math.max(draft.updatedAt, item.at);
      if (item.last !== undefined) draft.lastMessage = clip(item.last, previewLength);
      if (draft.title === null && item.firstUser !== undefined) draft.title = clip(item.firstUser, titleLength);
    }, context);
  };
  const drain = async (): Promise<void> => {
    scheduled = false;
    const batch = [...pending]; pending.clear();
    for (const [id, item] of batch) {
      try { await apply(id, item); } catch (error) { options.onError?.(error); }
    }
  };
  const observe = (publication: CommitPublication) => {
    let found = false;
    for (const change of publication.changes) {
      if (change.type !== 'entry') continue;
      const entry: EntryRecord = change.value;
      for (const message of entry.model ?? []) {
        const text = messageText(message);
        if (text === undefined) continue;
        const item = pending.get(entry.conversationId) ?? { at: now() };
        if (message.role === 'user' && item.firstUser === undefined) item.firstUser = text;
        item.last = text; item.at = now();
        pending.set(entry.conversationId, item);
        found = true;
      }
    }
    if (found && !scheduled) { scheduled = true; chain = chain.then(drain); }
  };
  const unsubscribe = harness.subscribeCommits(observe);
  const unsubscribeClose = harness.subscribeClose(() => { unsubscribe(); });

  async function derive(conversation: Conversation): Promise<{ title?: string; last?: string }> {
    let cursor: Cursor | undefined, first: { id: bigint; text: string } | undefined, last: string | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const page = await conversation.entries({}, 100, cursor, context);
      for (const entry of page.items) for (const message of entry.model ?? []) {
        const text = messageText(message);
        if (text === undefined) continue;
        if (last === undefined) last = text;
        if (message.role === 'user' && (!first || BigInt(entry.id) < first.id)) first = { id: BigInt(entry.id), text };
      }
      if (!page.next) break;
      cursor = page.next;
    }
    return { ...(first ? { title: first.text } : {}), ...(last === undefined ? {} : { last }) };
  }

  const initial = (owner: string, fields: Partial<ConversationMetadata>): ConversationInit => async (tx, id) => {
    const meta = await tx.doc(conversationMetadata, id);
    const at = now();
    Object.assign(meta, { owner, title: null, createdAt: at, updatedAt: at, lastMessage: null, archived: false, deletedAt: null }, fields);
  };
  const ownerKey = (owner: string) => { if (typeof owner !== 'string' || owner === '') throw new TypeError('An owner is required'); return owner; };
  const titleOf = (title: string) => { const value = clip(String(title), 200); if (!value) throw new TypeError('A title is required'); return value; };

  return {
    async create(owner, createOptions = {}) {
      const init = initial(ownerKey(owner), createOptions.title === undefined ? {} : { title: titleOf(createOptions.title) });
      return createOptions.start ? createOptions.start(init) : harness.createConversation({ ownership: { kind: 'ownerless' }, init }, context);
    },
    async adopt(id, owner, adoptOptions = {}) {
      ownerKey(owner);
      const conversation = await harness.conversation(id, context);
      if (!conversation) return undefined;
      const existing = await read(id);
      if (managed(existing)) return existing.owner === owner ? summary(id, existing) : undefined;
      const derived = await derive(conversation);
      const at = now();
      const meta = await harness.commit(async tx => {
        const draft = await tx.doc(conversationMetadata, id);
        Object.assign(draft, { owner, createdAt: adoptOptions.createdAt ?? adoptOptions.updatedAt ?? at, updatedAt: adoptOptions.updatedAt ?? adoptOptions.createdAt ?? at,
          title: adoptOptions.title !== undefined ? titleOf(adoptOptions.title) : derived.title !== undefined ? clip(derived.title, titleLength) : null,
          lastMessage: derived.last === undefined ? null : clip(derived.last, previewLength), archived: false, deletedAt: null });
        return { ...draft } as ConversationMetadata;
      }, context);
      return summary(id, meta);
    },
    async get(owner, id) { const meta = await read(id); return managed(meta, owner) ? summary(id, meta) : undefined; },
    async open(owner, id) { return managed(await read(id), owner) ? harness.conversation(id, context) : undefined; },
    async list(query) {
      const owner = ownerKey(query.owner);
      const archived = query.archived ?? false;
      const needle = query.query?.trim().toLowerCase() ?? '';
      const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 50)), 200);
      const found: ConversationSummary[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await harness.commit(tx => tx.scanConversations({}, 500, cursor), context);
        for (const record of page.items) {
          if (record.owner) continue; // conversations owned by a task (subagents) are never listed
          const meta = await read(record.id);
          if (!managed(meta, owner) || (archived !== 'all' && meta.archived !== archived)) continue;
          if (needle && !(meta.title ?? '').toLowerCase().includes(needle) && !(meta.lastMessage ?? '').toLowerCase().includes(needle)) continue;
          found.push(summary(record.id, meta));
        }
        cursor = page.next;
      } while (cursor);
      found.sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id));
      let start = 0;
      if (query.cursor) {
        const [at, id] = query.cursor.split(':').map(Number);
        start = found.findIndex(item => item.updatedAt < at! || (item.updatedAt === at && Number(item.id) < id!));
        if (start < 0) start = found.length;
      }
      const items = found.slice(start, start + limit);
      const tail = items.at(-1);
      return start + limit < found.length && tail ? { items, next: `${tail.updatedAt}:${Number(tail.id)}` } : { items };
    },
    async rename(owner, id, title) {
      const value = titleOf(title);
      const meta = await write(id, ownerKey(owner), meta => { meta.title = value; return { ...meta }; });
      return meta && summary(id, meta);
    },
    async archive(owner, id, archived = true) {
      const meta = await write(id, ownerKey(owner), meta => { meta.archived = archived; return { ...meta }; });
      return meta && summary(id, meta);
    },
    async delete(owner, id) {
      if (!managed(await read(id), ownerKey(owner))) return false;
      await (await harness.conversation(id, context))?.abort(context);
      return (await write(id, owner, meta => { meta.deletedAt = now(); return true; })) === true;
    },
    async fork(owner, id, at, forkOptions = {}) {
      const source = await read(id);
      if (!managed(source, ownerKey(owner))) return undefined;
      const conversation = await harness.conversation(id, context);
      if (!conversation) return undefined;
      // The preview of the fork is the last message it inherits: one bounded page of its history up to `at`.
      let last: string | undefined;
      const page = await conversation.entries({ maxEntryId: at }, 50, undefined, context);
      for (const entry of page.items) { for (const message of [...entry.model ?? []].reverse()) { last = messageText(message); if (last !== undefined) break; } if (last !== undefined) break; }
      const title = forkOptions.title !== undefined ? titleOf(forkOptions.title) : clip(`${source.title ?? 'New conversation'} (fork)`, 200);
      return conversation.fork(at, { ownership: { kind: 'ownerless' }, init: initial(owner, { title, lastMessage: last === undefined ? null : clip(last, previewLength) }) }, context);
    },
    async flush() { while (scheduled || pending.size) await chain; await chain; },
    async dispose() { unsubscribe(); unsubscribeClose(); await chain; },
  };
}

// ---- HTTP: one endpoint, operations in `?op=`, like the chat transport.

/** What the host's authentication decides for one request: whose conversations, and how to start one. */
export interface ConversationsAccess {
  readonly owner: string;
  /** How `create` starts the native conversation (the host's agent). Default: an ownerless conversation. */
  readonly start?: (init: ConversationInit) => Promise<Conversation>;
  /** Called with a conversation this request created or forked (for example to register its environment). */
  readonly opened?: (conversation: Conversation) => void | Promise<void>;
  /** Called after this request deleted a conversation. */
  readonly deleted?: (id: ConversationId) => void | Promise<void>;
  /** Refuse an operation; listing included. */
  readonly allow?: (operation: 'list' | 'create' | 'rename' | 'archive' | 'delete' | 'fork') => boolean | Promise<boolean>;
}

export interface ConversationsHandlerOptions {
  readonly conversations: Conversations;
  /** Authenticate in trusted host code and name the owner. Null refuses. The host also enforces its Origin/CSRF policy here. */
  readonly authenticate: (request: Request) => Promise<ConversationsAccess | null>;
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const failure = (status: number, reason: string) => Response.json({ reason }, { status, headers });
const idOf = (value: unknown): ConversationId | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value as ConversationId
  : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) as ConversationId : undefined;

/**
 * Fetch handler for a conversation list: `GET` (`?archived=1|all&q=&limit=&cursor=`) lists, `POST` with `?op=create` (the
 * default), `rename` `{ conversationId, title }`, `archive` `{ conversationId, archived? }`, `delete` `{ conversationId }` or
 * `fork` `{ conversationId, at, title? }`. Every POST needs a JSON body.
 */
export function createConversationsHandler(options: ConversationsHandlerOptions): (request: Request) => Promise<Response> {
  const { conversations } = options;
  return async request => {
    const params = new URL(request.url).searchParams;
    const operation = params.get('op') ?? (request.method === 'GET' ? 'list' : 'create');
    if (request.method === 'POST' && !hasJsonContentType(request.headers)) return failure(415, 'unsupported-media-type');
    let access: ConversationsAccess | null;
    try { access = await options.authenticate(request); } catch { return failure(503, 'authentication-unavailable'); }
    if (!access) return failure(401, 'authentication-required');
    const { owner } = access;
    const allowed = async (name: Parameters<NonNullable<ConversationsAccess['allow']>>[0]) => access.allow === undefined || await access.allow(name) === true;
    try {
      if (request.method === 'GET' && operation === 'list') {
        if (!await allowed('list')) return failure(403, 'not-authorized');
        const archived = params.get('archived');
        const limit = params.get('limit');
        const page = await conversations.list({ owner, archived: archived === 'all' ? 'all' : archived === '1' || archived === 'true',
          ...(params.get('q') ? { query: params.get('q')! } : {}), ...(limit ? { limit: Number(limit) || 50 } : {}), ...(params.get('cursor') ? { cursor: params.get('cursor')! } : {}) });
        return Response.json({ conversations: page.items, ...(page.next ? { next: page.next } : {}) }, { headers });
      }
      if (request.method !== 'POST') return failure(404, 'unknown-operation');
      const input = await readJsonBody(request, 65_536, request.signal).catch(error => { if (error instanceof RequestGuardError && error.status !== 400) throw error; return {}; });
      const body = (input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
      const title = typeof body['title'] === 'string' ? body['title'] : undefined;
      if (operation === 'create') {
        if (!await allowed('create')) return failure(403, 'not-authorized');
        const created = await conversations.create(owner, { ...(title === undefined ? {} : { title }), ...(access.start ? { start: access.start } : {}) });
        await access.opened?.(created);
        return Response.json({ conversationId: created.id }, { headers });
      }
      const id = idOf(body['conversationId']);
      if (id === undefined) return failure(400, 'invalid-request');
      if (operation === 'rename') {
        if (title === undefined || !title.trim()) return failure(400, 'invalid-request');
        if (!await allowed('rename')) return failure(403, 'not-authorized');
        const renamed = await conversations.rename(owner, id, title);
        return renamed ? Response.json({ conversation: renamed }, { headers }) : failure(404, 'unknown-conversation');
      }
      if (operation === 'archive') {
        if (body['archived'] !== undefined && typeof body['archived'] !== 'boolean') return failure(400, 'invalid-request');
        if (!await allowed('archive')) return failure(403, 'not-authorized');
        const changed = await conversations.archive(owner, id, body['archived'] !== false);
        return changed ? Response.json({ conversation: changed }, { headers }) : failure(404, 'unknown-conversation');
      }
      if (operation === 'delete') {
        if (!await allowed('delete')) return failure(403, 'not-authorized');
        if (!await conversations.delete(owner, id)) return failure(404, 'unknown-conversation');
        await access.deleted?.(id);
        return Response.json({ deleted: true }, { headers });
      }
      if (operation === 'fork') {
        const at = idOf(body['at']);
        if (at === undefined) return failure(400, 'invalid-request');
        if (!await allowed('fork')) return failure(403, 'not-authorized');
        const forked = await conversations.fork(owner, id, at as unknown as EntryId, title === undefined ? {} : { title });
        if (!forked) return failure(404, 'unknown-conversation');
        await access.opened?.(forked);
        return Response.json({ conversationId: forked.id }, { headers });
      }
    } catch (error) {
      if (error instanceof RequestGuardError) return failure(error.status, error.status === 413 ? 'request-too-large' : 'invalid-request');
      if (error instanceof TypeError) return failure(400, 'invalid-request');
      return failure(503, error instanceof Error && error.message ? `source-unavailable: ${error.message.slice(0, 200)}` : 'source-unavailable');
    }
    return failure(404, 'unknown-operation');
  };
}
