import { parsePresentedArtifact } from '../chat-artifacts.js';
import type { PresentedArtifact } from '../chat-artifacts.js';
import { randomUUID } from '@hachej/boring-files/platform';
import { ChannelRequestError } from './error.js';
import type { Card, CardAction, ChannelEvent, ChannelMessage, ChannelSource, Conversation, Member, Step } from './source.js';

/**
 * A ChannelSource over the host's room door (`POST _room/<op>`, boring-factory `services/channel/room.mjs`) and its space
 * WebSocket. The room is a pi-durable session: its order is the entry id, its view is the pure fold `roomView`, and a reader
 * resumes from an entry id. The old `createChannelSocket` is untouched; this source is opt-in.
 */
export interface RoomWords {
  /** The card an agent's message turns into after `stallMs` with no frame (budget B6). */
  readonly stalled: string;
  readonly retry: string;
  /** The label of a card's action when the room names it by id only (`try`, `later`, `validate`). */
  readonly actions: Readonly<Record<string, string>>;
  /** Titles of the room's own conversations. */
  readonly titles: Readonly<Record<string, string>>;
}
const words: Record<'en' | 'fr', RoomWords> = {
  en: { stalled: 'Still working on it…', retry: 'Try again', actions: { try: 'Try', later: 'Later', validate: 'Approve' }, titles: { main: 'Team', admin: 'Admin' } },
  fr: { stalled: 'Toujours en train de répondre…', retry: 'Réessayer', actions: { try: 'Essayer', later: 'Plus tard', validate: 'Valider' }, titles: { main: 'Équipe', admin: 'Admin' } },
};

export interface RoomSourceOptions {
  /** The app's URL, for example `https://app.example/`. The door is `<url>/_room/<op>`, the socket `<url>/spaces/<space>/live`. */
  readonly url: string | URL;
  readonly fetch?: (request: Request) => Promise<Response>;
  /** Host subprotocol authentication may be supplied here. */
  readonly open?: (url: URL) => WebSocket;
  readonly reconnectMs?: number;
  /** A socket that has not opened after this long is given up and retried. Default 10000. */
  readonly openMs?: number;
  /** Call `POST _channel/join` before anything else (default). `false` for a host that enrols people another way. */
  readonly join?: boolean;
  readonly locale?: 'en' | 'fr';
  /** Overrides the words (the stalled line, Retry, the titles of `main` and `admin`). */
  readonly words?: Partial<RoomWords>;
  /** No frame for this long while an agent writes: its message offers Retry (B6). Default 8000. */
  readonly stallMs?: number;
  readonly now?: () => number;
}
export interface RoomSource extends ChannelSource {
  readonly space: string;
  readonly engine: 'room';
  /** The last entry id this source has read for the conversation (what a resume asks `after`). */
  readonly cursor: (conversationId: string) => number | undefined;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown): string[] => list(value).filter((item): item is string => typeof item === 'string');
const id = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
const stepStatus = (value: unknown): Step['status'] => value === 'running' || value === 'failed' ? value : 'done';

const descriptorKey = (artifact: PresentedArtifact): string => JSON.stringify(artifact.type === 'task' ? artifact.subject : [artifact.target, artifact.revision]);
const descriptors = (raw: unknown): PresentedArtifact[] => {
  const found = new Map<string, PresentedArtifact>();
  for (const value of list(raw)) { const artifact = parsePresentedArtifact(value); if (artifact) found.set(descriptorKey(artifact), artifact); }
  return [...found.values()];
};

function member(raw: unknown): Member | undefined {
  if (!isObject(raw) || typeof raw.id !== 'string') return undefined;
  const kind = raw.kind === 'agent' || raw.kind === 'admin' ? raw.kind : 'person';
  const role = typeof raw.role === 'string' ? raw.role : undefined;
  // The room names an agent's role by its slug (`pm`, `worker`); the view reads `agent:<name>`.
  const normalised = kind === 'agent' ? `agent:${(role ?? raw.id).replace(/^agent:/, '')}` as const
    : role === 'owner' || role === 'validator' || role === 'member' || role === 'admin' ? role : undefined;
  return { id: raw.id, name: str(raw.name, raw.id), kind, ...(normalised ? { role: normalised } : {}), ...(typeof raw.roleLabel === 'string' ? { roleLabel: raw.roleLabel } : {}),
    ...(typeof raw.avatarUrl === 'string' ? { avatarUrl: raw.avatarUrl } : {}), ...(raw.presence === 'here' || raw.presence === 'away' ? { presence: raw.presence } : {}) };
}

type Wake = { readonly id: string; readonly agent: string; readonly conversation: string };
type Writing = { wake: Wake; segment: number; text: string; steps: Step[]; artifacts: PresentedArtifact[]; stalled: boolean; timer: ReturnType<typeof setTimeout> | undefined; at: string };
type Conv = {
  /** The messages of the conversation by entry id, ascending. */
  list: ChannelMessage[];
  /** The resume cursor: the last entry id read, advanced by a history read or by a frame of the same unbroken socket. */
  cursor: number | undefined; cursorEpoch: number;
  loaded: boolean; loading: Promise<void> | undefined;
  /** Agents writing now, and agents whose wake is open but who wait for a person's answer to a question. */
  writing: Map<string, Writing>; waiting: Map<string, Writing>;
};

export async function createRoomSource(options: RoomSourceOptions): Promise<RoomSource> {
  const base = new URL(options.url, globalThis.location?.href);
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  const request = options.fetch ?? (request => globalThis.fetch(request));
  const now = options.now ?? Date.now;
  const text = { ...words[options.locale ?? 'en'], ...options.words };
  const stallMs = options.stallMs ?? 8000;
  const url = (path: string) => new URL(path, base);

  async function rpc(op: string, input: unknown = {}, door = '_room'): Promise<unknown> {
    let response: Response;
    try { response = await request(new Request(url(`${door}/${op}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })); }
    catch (error) { throw new ChannelRequestError('network', error instanceof Error ? error.message : 'Channel connection was lost', true); }
    const body: unknown = await response.json().catch(() => undefined);
    if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string') {
      throw new ChannelRequestError(body.error.code, str(body.error.message, body.error.code), body.error.retryable === true, { refused: true });
    }
    if (!response.ok || body === undefined) throw new ChannelRequestError('invalid-response', `Room ${op} returned an invalid response (${response.status})`, false);
    return body;
  }

  // The web door never enrols anyone: a person's first visit is the explicit `_channel/join` (the directory-role admission check, the same on
  // either engine), before any `_room/*` call. A refusal is `no-access`: the host shows a calm « no access » state, not an error.
  const noAccess = (error: unknown): never => {
    if (error instanceof ChannelRequestError && error.refused && ['not-found', 'forbidden', 'unauthorized'].includes(error.code)) throw new ChannelRequestError('no-access', error.message, false, { refused: true });
    throw error;
  };
  if (options.join !== false) await rpc('join', { idempotencyKey: randomUUID() }, '_channel').catch(noAccess);
  const boot = await rpc('me').catch(noAccess);
  const me = isObject(boot) && typeof boot.space === 'string' && boot.space ? member(boot.me) : undefined;
  if (!me || !isObject(boot) || typeof boot.space !== 'string') throw new ChannelRequestError('invalid-response', 'Room me returned an invalid response', false);
  const space = boot.space;

  const convs = new Map<string, Conv>();
  const conv = (name: string): Conv => {
    let found = convs.get(name);
    if (!found) { found = { list: [], cursor: undefined, cursorEpoch: -1, loaded: false, loading: undefined, writing: new Map(), waiting: new Map() }; convs.set(name, found); }
    return found;
  };
  const owner = new Map<number, string>();
  const clientIds = new Map<number, string>();
  const subscribers = new Map<string, Set<{ event: (event: ChannelEvent) => void; status: ((status: 'live' | 'reconnecting' | 'offline') => void) | undefined }>>();
  const inflight = new Map<string, { conversationId: string; text: string }>();
  const emit = (name: string, event: ChannelEvent) => { for (const listener of [...(subscribers.get(name) ?? [])]) listener.event(structuredClone(event)); };

  // ---- time: the door's items carry none yet, so a message is stamped when this source first sees it, in entry order ----
  const stamps = new Map<number, number>();
  let lowId = Infinity, highId = -Infinity, lowMs = 0, highMs = 0;
  function stamp(entries: readonly number[]): void {
    const fresh = [...new Set(entries)].filter(entry => !stamps.has(entry)).sort((a, b) => a - b);
    if (!fresh.length) return;
    const time = now();
    if (!stamps.size) fresh.forEach((entry, index) => stamps.set(entry, time - (fresh.length - 1 - index)));
    else {
      const below = fresh.filter(entry => entry < lowId).reverse();
      below.forEach((entry, index) => stamps.set(entry, lowMs - 1 - index));
      let next = Math.max(time, highMs + 1);
      for (const entry of fresh.filter(entry => entry > highId)) stamps.set(entry, next++);
      // An entry between two known ones (a read that skipped it) takes its lower neighbour's time: the order is the entry's.
      for (const entry of fresh.filter(entry => !stamps.has(entry))) { let at = lowMs; for (const [known, ms] of stamps) if (known < entry && ms >= at) at = ms; stamps.set(entry, at); }
    }
    for (const entry of fresh) {
      const ms = stamps.get(entry)!;
      if (entry < lowId) { lowId = entry; lowMs = ms; }
      if (entry > highId) { highId = entry; highMs = ms; }
    }
  }
  const iso = (entry: number, given?: unknown): string => {
    if (typeof given === 'number' && Number.isFinite(given)) return new Date(given).toISOString();
    if (typeof given === 'string' && Number.isFinite(Date.parse(given))) return given;
    return new Date(stamps.get(entry) ?? now()).toISOString();
  };
  const after = () => new Date(Math.max(now(), highMs + 1)).toISOString();

  // ---- item to message ----
  const actionsOf = (raw: unknown): CardAction[] => list(raw).flatMap((action): CardAction[] => {
    if (typeof action === 'string') return [{ id: action, label: text.actions[action] ?? action, ...(action === 'later' ? { variant: 'secondary' as const } : {}) }];
    if (isObject(action) && typeof action.id === 'string') return [{ id: action.id, label: str(action.label, action.id), ...(action.variant === 'primary' || action.variant === 'secondary' ? { variant: action.variant } : {}) }];
    return [];
  });
  function convert(name: string, item: unknown): ChannelMessage | { retract: number } | undefined {
    if (!isObject(item)) return undefined;
    const entry = id(item.id);
    if (entry === undefined) return undefined;
    if (item.kind === 'removed') { const target = id(item.target); return target === undefined ? undefined : { retract: target }; }
    stamp([entry]);
    const at = iso(entry, item.at);
    const author = str(item.author);
    const base = { id: String(entry), conversationId: name, at };
    const mine = clientIds.get(entry);
    if (item.kind === 'message') {
      const speaker = author.startsWith('platform:') ? str(item.for) : author;
      const gone = item.removed === true;
      if (!speaker) return { ...base, author: 'platform:room', kind: 'system', text: str(item.text) };
      return { ...base, author: speaker, ...(typeof item.via === 'string' ? { via: item.via } : {}),
        ...(gone ? { removed: { by: '', at } } : { text: str(item.text) }), mentions: strings(item.mentions), ...(id(item.replyTo) !== undefined ? { replyTo: String(item.replyTo) } : {}),
        ...(gone || !Array.isArray(item.artifacts) ? {} : { artifacts: descriptors(item.artifacts) }),
        ...(gone ? {} : { attachments: list(item.attachments).filter(isObject).filter(file => typeof file.path === 'string').map(file => ({ path: str(file.path) })) }),
        ...(gone ? {} : { steps: list(item.steps).filter(isObject).map((step): Step => ({ label: str(step.label), status: stepStatus(step.status) })) }),
        ...(mine ? { clientId: mine } : {}) };
    }
    if (item.kind === 'system') return { ...base, author: 'platform:room', kind: 'system', text: str(item.line) };
    if (item.kind === 'pin') return { ...base, author, card: { requestId: `pin:${entry}`, kind: 'pin', title: str(item.title), line: str(item.line) } };
    if (item.kind === 'question') {
      const options = strings(item.options);
      return { ...base, author, text: str(item.prompt), question: { callId: str(item.callId), prompt: str(item.prompt), options, allowFreeText: item.allowFreeText !== false || options.length === 0, answered: item.answered === true }, ...(Array.isArray(item.artifacts) ? { artifacts: descriptors(item.artifacts) } : {}) };
    }
    if (item.kind === 'card') {
      const card = item.card;
      if (!isObject(card)) return undefined; // The card's state is not in the room yet (R5): nothing to show, and never a bare request id.
      const since = card.since;
      const shown: Card = { requestId: str(item.requestId), kind: 'request', title: str(card.title), line: str(card.line), ...(typeof card.state === 'string' ? { state: card.state } : {}),
        ...(typeof since === 'number' ? { since: new Date(since).toISOString() } : typeof since === 'string' ? { since } : {}), actions: actionsOf(card.actions) };
      return { ...base, author, card: shown };
    }
    return undefined; // A kind a newer host adds is not drawn, never refused.
  }

  const sameMessage = (a: ChannelMessage, b: ChannelMessage) => JSON.stringify({ ...a, clientId: undefined }) === JSON.stringify({ ...b, clientId: undefined });

  // ---- the cache: messages by entry id, so history pages and resumes are slices ----
  function put(c: Conv, message: ChannelMessage): ChannelMessage {
    const entry = Number(message.id);
    const index = c.list.findIndex(existing => Number(existing.id) >= entry);
    if (index >= 0 && c.list[index]!.id === message.id) { const kept = c.list[index]!; const merged = { ...message, ...(message.clientId || !kept.clientId ? {} : { clientId: kept.clientId }) }; c.list[index] = merged; return merged; }
    if (index < 0) c.list.push(message); else c.list.splice(index, 0, message);
    return message;
  }
  function markRemoved(c: Conv, target: number): ChannelMessage | undefined {
    const index = c.list.findIndex(message => message.id === String(target));
    const found = c.list[index];
    if (!found || found.removed) return undefined;
    const { text: _text, attachments: _attachments, artifacts: _artifacts, steps: _steps, card: _card, question: _question, ...rest } = found;
    c.list[index] = { ...rest, removed: { by: '', at: found.at } };
    return c.list[index];
  }
  /** A reply to a question answers it: the question card shows as answered, in place. */
  function noteReply(c: Conv, name: string, message: ChannelMessage): void {
    if (!message.replyTo) return;
    const index = c.list.findIndex(existing => existing.id === message.replyTo);
    const asked = c.list[index];
    if (!asked?.question || asked.question.answered) return;
    c.list[index] = { ...asked, question: { ...asked.question, answered: true } };
    emit(name, { type: 'message', message: c.list[index]! });
  }

  // ---- the writing state: an open wake draws the agent's message, in place, until its answer lands ----
  const clientIdOf = (w: Writing) => `wake:${w.wake.id}#${w.segment}`;
  const placeholder = (w: Writing): ChannelMessage => ({ id: `wake:${w.wake.id}`, conversationId: w.wake.conversation, author: w.wake.agent, at: w.at, streaming: true, clientId: clientIdOf(w),
    ...(w.stalled ? { card: { requestId: `wake:${w.wake.id}`, kind: 'request' as const, title: text.stalled, line: '', actions: [{ id: 'retry', label: text.retry }] } } : { text: w.text }), steps: w.steps.map(step => ({ ...step })), ...(w.artifacts.length ? { artifacts: structuredClone(w.artifacts) } : {}) });
  function arm(w: Writing): void {
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      if (!conv(w.wake.conversation).writing.has(w.wake.id) || w.stalled) return;
      w.stalled = true; emit(w.wake.conversation, { type: 'message', message: placeholder(w) });
    }, stallMs);
  }
  /** Opens the writing message of a wake (once). `shown: false` when the caller returns it itself, as a history read does. */
  function wake(raw: unknown, shown = true): Writing | undefined {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.agent !== 'string') return undefined;
    const name = str(raw.conversation, 'main'), c = conv(name);
    const found = c.writing.get(raw.id) ?? c.waiting.get(raw.id);
    if (found) return found;
    const w: Writing = { wake: { id: raw.id, agent: raw.agent, conversation: name }, segment: 0, text: '', steps: [], artifacts: [], stalled: false, timer: undefined, at: after() };
    c.writing.set(raw.id, w); arm(w);
    if (shown) emit(name, { type: 'message', message: placeholder(w) });
    return w;
  }
  /** A frame of an open wake: the writing message grows in place. The frame may name its conversation; else the wake's cause entry does. */
  function frame(raw: Json): void {
    const wakeId = str(raw.wakeId);
    const name = typeof raw.conversationId === 'string' ? raw.conversationId : owner.get(Number.parseInt(wakeId, 10)) ?? (subscribers.has('main') ? 'main' : [...subscribers.keys()][0]);
    if (!name) return;
    const c = conv(name);
    const agent = wakeId.slice(wakeId.indexOf(':') + 1);
    const w = c.writing.get(wakeId) ?? wake({ id: wakeId, agent, conversation: name });
    if (!w || c.waiting.has(wakeId)) return;
    const wasStalled = w.stalled;
    w.stalled = false; arm(w);
    if (raw.type === 'artifact') {
      w.artifacts = descriptors([...w.artifacts, raw.artifact]);
      emit(name, { type: 'message', message: placeholder(w) });
    } else if (raw.type === 'delta') {
      const piece = str(raw.text);
      w.text += piece;
      emit(name, wasStalled ? { type: 'message', message: placeholder(w) } : { type: 'delta', messageId: placeholder(w).id, conversationId: name, text: piece });
    } else {
      const label = str(raw.label), status = stepStatus(raw.status);
      let index = w.steps.findIndex(step => step.label === label && step.status === 'running');
      if (index < 0) { w.steps.push({ label, status }); index = w.steps.length - 1; } else w.steps[index] = { label, status };
      emit(name, wasStalled ? { type: 'message', message: placeholder(w) } : { type: 'step', messageId: placeholder(w).id, conversationId: name, index, step: { label, status } });
    }
  }
  /**
   * An agent's own entry takes its writing message's place (same clientId, so the thread swaps them). A question does the same and parks
   * the wake: the agent now waits for a person, so nothing says it is working and nothing times out. The answer wakes it again.
   */
  function settle(c: Conv, message: ChannelMessage): ChannelMessage {
    if (message.kind === 'system' || message.removed || !message.author.startsWith('agent:')) return message;
    const w = [...c.writing.values()].find(candidate => candidate.wake.agent === message.author);
    if (!w) { if (!message.question) for (const [key, parked] of c.waiting) if (parked.wake.agent === message.author) c.waiting.delete(key); return message; }
    const adopted = { ...message, clientId: clientIdOf(w) };
    clearTimeout(w.timer); c.writing.delete(w.wake.id);
    if (message.question) { w.segment++; w.text = ''; w.steps = []; w.stalled = false; c.waiting.set(w.wake.id, w); }
    return adopted;
  }
  /** A person's answer to a question: the parked agent works again, and a later frame (or this one) draws a new writing message. */
  function resume(c: Conv, answer: ChannelMessage): void {
    const asked = answer.replyTo ? c.list.find(message => message.id === answer.replyTo) : undefined;
    if (!asked?.question) return;
    for (const [key, w] of c.waiting) if (w.wake.agent === asked.author) {
      c.waiting.delete(key); w.at = after(); c.writing.set(key, w); arm(w);
      emit(w.wake.conversation, { type: 'message', message: placeholder(w) });
    }
  }

  // ---- reading ----
  function absorb(name: string, c: Conv, items: unknown[]): ChannelMessage[] {
    const entries = items.flatMap(item => isObject(item) && id(item.id) !== undefined ? [id(item.id)!] : []);
    for (const entry of entries) owner.set(entry, name);
    stamp(entries.filter(entry => !stamps.has(entry)));
    const out: ChannelMessage[] = [];
    for (const item of items) {
      const converted = convert(name, item);
      if (!converted) continue;
      if ('retract' in converted) { const gone = markRemoved(c, converted.retract); if (gone) out.push(gone); continue; }
      out.push(put(c, converted));
    }
    return out;
  }
  async function read(name: string, c: Conv): Promise<void> {
    const epoch = socketEpoch;
    const from = c.loaded ? c.cursor : undefined;
    const body = await rpc('history', { conversationId: name, ...(from === undefined ? {} : { after: from }) });
    if (!isObject(body)) throw new ChannelRequestError('invalid-response', 'Room history returned an invalid response', false);
    for (const message of absorb(name, c, list(body.items))) if (c.loaded) noteReply(c, name, message);
    const through = id(body.cursor);
    if (through !== undefined) { c.cursor = Math.max(c.cursor ?? 0, through); c.cursorEpoch = epoch; }
    c.loaded = true;
    // Open wakes, when the host says them: a reload redraws the writing message, and a wake that ended elsewhere clears.
    if (Array.isArray(body.wakes)) {
      const open = body.wakes.filter(isObject).filter(w => w.conversation === name || (w.conversation === undefined && name === 'main'));
      for (const raw of open) wake({ ...raw, conversation: name }, false);
      for (const [key, w] of c.writing) if (!open.some(raw => raw.id === w.wake.id)) { clearTimeout(w.timer); c.writing.delete(key); }
    }
  }
  const sync = (name: string): Promise<void> => {
    const c = conv(name);
    return c.loading ??= read(name, c).finally(() => { c.loading = undefined; });
  };

  // ---- the socket: one per source, shared by its subscribers, resumed by cursor ----
  let socket: WebSocket | undefined, opening: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined, attempt = 0, socketEpoch = 0, live = false;
  const announce = (status: 'live' | 'reconnecting' | 'offline') => { for (const set of subscribers.values()) for (const listener of [...set]) listener.status?.(status); };
  function onFrame(raw: unknown): void {
    if (!isObject(raw)) return;
    if (raw.type === 'message') {
      const name = str(raw.conversationId);
      if (!subscribers.has(name) && !convs.has(name)) return;
      const c = conv(name);
      const entry = isObject(raw.item) ? id(raw.item.id) : undefined;
      if (entry === undefined) return;
      owner.set(entry, name);
      // My own message may reach me by the socket before its HTTP answer: it takes the clientId of the send waiting for it.
      if (isObject(raw.item) && raw.item.mine === true && !clientIds.has(entry)) {
        const match = [...inflight].find(([, sent]) => sent.conversationId === name && isObject(raw.item) && sent.text === raw.item.text);
        if (match) { clientIds.set(entry, match[0]); inflight.delete(match[0]); }
      }
      // A frame of a socket that has been up since the last read keeps the resume cursor current; after a reconnect the next read does.
      if (c.cursorEpoch === socketEpoch) c.cursor = Math.max(c.cursor ?? 0, entry);
      const converted = convert(name, raw.item);
      if (!converted) return;
      if ('retract' in converted) { const gone = markRemoved(c, converted.retract); if (gone) emit(name, { type: 'message', message: gone }); return; }
      const settled = settle(c, converted);
      const before = c.list.find(existing => existing.id === settled.id);
      const stored = put(c, settled);
      if (!before || !sameMessage(before, stored)) emit(name, { type: 'message', message: stored });
      noteReply(c, name, stored);
      resume(c, stored);
    } else if (raw.type === 'delta' || raw.type === 'step' || raw.type === 'artifact') frame(raw);
    else if (raw.type === 'wake') { const name = str(raw.conversationId, 'main'); wake({ id: str(raw.wakeId, str(raw.id)), agent: str(raw.agent), conversation: name }); }
    else if (raw.type === 'presence') {
      const members = list(raw.members).filter(isObject).flatMap((m): { id: string; presence: 'here' | 'away' }[] => typeof m.id === 'string' && (m.presence === 'here' || m.presence === 'away') ? [{ id: m.id, presence: m.presence }] : []);
      for (const name of subscribers.keys()) emit(name, { type: 'presence', members });
    } else if (raw.type === 'members') {
      const name = str(raw.conversationId);
      emit(name, { type: 'members', conversationId: name, members: list(raw.members).flatMap(m => { const found = member(m); return found ? [found] : []; }) });
    }
  }
  function connect(): void {
    if (!subscribers.size || socket) return;
    announce('reconnecting');
    const target = url(`spaces/${encodeURIComponent(space)}/live`); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    let current: WebSocket;
    try { current = (options.open ?? (target => new WebSocket(target)))(target); }
    catch { lost(); return; }
    socket = current;
    current.onopen = () => { if (current !== socket) return; clearTimeout(opening); attempt = 0; live = true; socketEpoch++; announce('live'); };
    current.onmessage = event => {
      if (current !== socket || typeof event.data !== 'string') return;
      try { onFrame(JSON.parse(event.data)); } catch { /* a malformed frame is dropped; the entries are the truth and a resume reads them */ }
    };
    // A socket that fails to open may report an error and no close (and close() on it reports the error again): either ends it.
    const ended = () => { if (current === socket) { socket = undefined; live = false; clearTimeout(opening); lost(); } };
    opening = setTimeout(() => { if (current === socket && current.readyState !== 1) { try { current.close(); } catch { /* already closed */ } ended(); } }, options.openMs ?? 10000);
    current.onerror = () => { if (current.readyState === 1) current.close(); else ended(); };
    current.onclose = ended;
  }
  function lost(): void {
    if (!subscribers.size) return;
    announce('offline');
    clearTimeout(retry);
    retry = setTimeout(connect, Math.min(30000, (options.reconnectMs ?? 1000) * 2 ** attempt++));
  }

  // A phone coming out of a tunnel says so: reconnect now instead of waiting out the backoff.
  const nudge = () => { if (socket || !subscribers.size) return; clearTimeout(retry); attempt = 0; connect(); };
  let listening = false;
  const listen = (on: boolean) => {
    if (on === listening || typeof globalThis.addEventListener !== 'function') return;
    listening = on;
    if (on) globalThis.addEventListener('online', nudge); else globalThis.removeEventListener('online', nudge);
  };

  const dropEmpty = () => {
    if ([...subscribers.values()].some(set => set.size)) return;
    listen(false); clearTimeout(retry); clearTimeout(opening); const current = socket; socket = undefined; live = false; current?.close();
    for (const c of convs.values()) for (const w of [...c.writing.values(), ...c.waiting.values()]) clearTimeout(w.timer);
  };

  // ---- the ChannelSource ----
  const conversationsOf = async (): Promise<Conversation[]> => {
    const rows = list(await rpc('conversations')).filter(isObject).filter(row => typeof row.id === 'string');
    return Promise.all(rows.map(async row => {
      const name = str(row.id), kind = str(row.kind, name);
      const people = await rpc('members', { conversationId: name }).then(body => list(body).flatMap(m => member(m)?.id ?? []), () => []);
      return { id: name, title: text.titles[name] ?? name, kind: kind === 'main' || kind === 'admin' ? kind : 'direct', members: people };
    }));
  };
  const own = (message: ChannelMessage) => message.author === me.id;
  const source: RoomSource = {
    me, space, engine: 'room',
    cursor: name => convs.get(name)?.cursor,
    conversations: conversationsOf,
    members: async name => list(await rpc('members', { conversationId: name })).flatMap(m => member(m) ?? []),
    history: async (name, opts) => {
      const c = conv(name);
      await sync(name);
      const end = opts.before ? c.list.findIndex(message => message.id === opts.before) : c.list.length;
      if (end < 0) throw new ChannelRequestError('cursor', 'Unknown history cursor', false);
      const start = Math.max(0, end - opts.limit);
      const page = c.list.slice(start, end).map(message => structuredClone(message));
      // The writing messages belong to the newest page.
      const writing = opts.before ? [] : [...c.writing.values()].map(placeholder);
      return { messages: [...page, ...writing], ...(start > 0 && c.list[start] ? { before: c.list[start]!.id } : {}) };
    },
    send: async input => {
      inflight.set(input.clientId, { conversationId: input.conversationId, text: input.text });
      try {
        const replyTo = input.replyTo === undefined ? undefined : Number(input.replyTo);
        const body = await rpc('send', { conversationId: input.conversationId, text: input.text, mentions: input.mentions,
          ...(replyTo !== undefined && Number.isSafeInteger(replyTo) ? { replyTo } : {}), idempotencyKey: input.clientId });
        const entry = isObject(body) && isObject(body.entry) ? body.entry : undefined, data = entry && isObject(entry.data) ? entry.data : undefined, entryId = entry ? id(entry.id) : undefined;
        if (!entry || !data || entryId === undefined) throw new ChannelRequestError('invalid-response', 'Room send returned an invalid response', false);
        const name = str(isObject(body) ? body.conversation : undefined, input.conversationId);
        clientIds.set(entryId, input.clientId); owner.set(entryId, name);
        const c = conv(name);
        const message = convert(name, { kind: 'message', id: entryId, author: data.author, via: data.via, text: data.text, mentions: data.mentions, replyTo: data.replyTo, attachments: data.attachments, artifacts: data.artifacts, steps: data.steps, mine: true, removed: false });
        if (!message || 'retract' in message) throw new ChannelRequestError('invalid-response', 'Room send returned an invalid response', false);
        const stored = put(c, { ...message, clientId: input.clientId });
        noteReply(c, name, stored);
        resume(c, stored);
        // The wakes this message opened are in the answer: the agent's writing message shows now, before any frame (B2).
        if (isObject(body) && Array.isArray(body.wakes)) for (const raw of body.wakes) wake({ ...(isObject(raw) ? raw : {}), conversation: name });
        return structuredClone(stored);
      } finally { inflight.delete(input.clientId); }
    },
    action: async input => {
      if (input.actionId === 'retry' && input.requestId.startsWith('wake:')) { await rpc('retry', { conversationId: input.conversationId, wakeId: input.requestId.slice(5) }); return; }
      await rpc('action', { ...input, idempotencyKey: randomUUID() });
    },
    remove: async messageId => {
      const name = [...convs].find(([, c]) => c.list.some(message => message.id === messageId))?.[0];
      if (!name) throw new ChannelRequestError('not-found', 'No such message', false, { refused: true });
      await rpc('remove', { conversationId: name, messageId: Number(messageId), idempotencyKey: randomUUID() });
      // The door broadcasts no item for a removal: the remover's own screen is updated from the answer.
      const gone = markRemoved(conv(name), Number(messageId));
      if (gone) emit(name, { type: 'message', message: gone });
    },
    canRemove: message => !message.pending && !message.removed && message.kind !== 'system' && !message.question && !message.card
      && (own(message) || ((me.role === 'owner' || me.kind === 'admin') && !message.author.startsWith('agent:') && !message.author.startsWith('platform:'))),
    subscribe: (name, onEvent, onStatus) => {
      const listener = { event: onEvent, status: onStatus };
      let set = subscribers.get(name);
      if (!set) { set = new Set(); subscribers.set(name, set); }
      set.add(listener); listen(true);
      if (socket) onStatus?.(live ? 'live' : 'offline'); else connect();
      return () => { subscribers.get(name)?.delete(listener); dropEmpty(); };
    },
  };
  return source;
}
