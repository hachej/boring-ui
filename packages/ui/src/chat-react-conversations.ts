'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
export interface ConversationItem {
  readonly id: string;
  readonly title?: string | undefined;
  readonly updatedAt?: number | string | Date | undefined;
  readonly lastMessage?: string | null | undefined;
  readonly archived?: boolean | undefined;
}

/** Headless list/actions; row menus and other presentation extensions stay with the registry. */
export interface ConversationsClient {
  readonly items: readonly ConversationItem[];
  readonly activeId: string | undefined;
  /** New or fork is on its way: the conversation on screen is about to be left, so it must take no message (`PiChat` disables its composer). */
  readonly creating: boolean;
  /** The conversation New or fork just opened, for up to three seconds: `PiChat` puts the cursor in its box once, then calls `openedSeen`, so a later remount does not. */
  readonly opened: string | undefined;
  /** Ends `opened` and returns what the person typed since New, for the new box. */
  readonly openedSeen: () => string;
  /** New chat was refused or got no answer in time, in the conversation on screen. `typed`: the person's text was dropped. `PiChat` and `AmbientChat` say so. */
  readonly newFailed: { readonly typed: boolean } | undefined;
  /** The person closed that message. */
  readonly newFailedSeen: () => void;
  readonly reload: () => Promise<void>;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
  readonly search: (query: string, options: { readonly archived: boolean }, signal: AbortSignal) => Promise<readonly ConversationItem[]>;
  readonly rename: (id: string, title: string) => Promise<void>;
  readonly archive: (id: string, archived: boolean) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly fork: (atEntryId: string) => Promise<void>;
}
export interface ConversationsClientOptions {
  readonly endpoint: string | URL | undefined;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly activeId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onChange?: (() => void | Promise<void>) | undefined;
  readonly pollMs?: number;
  /** How long New or fork may hold the composer (`creating`) before the person gets it back and a late answer no longer moves them. Default 15 s. */
  readonly openTimeoutMs?: number;
}

/** One row as `createConversationsHandler` of `@hachej/boring-agent/conversations` returns it. */
interface ServedConversation {
  readonly id: number | string;
  readonly title: string | null;
  readonly lastMessage: string | null;
  readonly updatedAt: number;
  readonly archived: boolean;
}

const item = (served: ServedConversation): ConversationItem => ({ id: String(served.id), title: served.title ?? undefined, updatedAt: served.updatedAt, lastMessage: served.lastMessage, archived: served.archived });

/**
 * The sessions list over the host's conversations handler (`createConversationsHandler` of `@hachej/boring-agent/conversations`, mounted at
 * `endpoint`): the active list (polled every `pollMs` while mounted), server-side search with the Archived filter, New, rename, archive,
 * delete and fork. New and fork select the conversation they made through `onSelect`. `onChange` runs after every change the person made
 * (the host may reload what depends on the list). `fetch` is the host's authenticated fetch. Returns `undefined` until the first list arrives.
 */
const OPENED_MS = 3000;

/**
 * The clicked button keeps the focus until the new box is back, so a Space typed then would press New again, and the box is held, so the start of a message would be lost.
 * The focus goes to a hidden field until then: it outlives the chat's remount, and dead keys, IME and Backspace work there. Not on a phone, where it would open the keyboard.
 */
function holdTyping() {
  const page = globalThis.document, focused = page?.activeElement as HTMLElement | null | undefined;
  if (!page || focused?.matches('input, textarea, select, [contenteditable]')) return undefined;
  focused?.blur();
  if (globalThis.matchMedia?.('(pointer: coarse)').matches) return { field: undefined };
  const field = page.createElement('textarea');
  field.dataset.testid = 'new-chat-typing';
  field.tabIndex = -1;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px';
  field.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  page.body.append(field);
  field.focus();
  return { field };
}

export function useConversationsClient({ endpoint, fetch, activeId, onSelect, onChange, pollMs = 4000, openTimeoutMs = 15000 }: ConversationsClientOptions): ConversationsClient | undefined {
  const [items, setItems] = useState<readonly ConversationItem[] | undefined>();
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<string | undefined>();
  const [failedNew, setFailedNew] = useState<{ readonly at: string | undefined; readonly typed: boolean } | undefined>();
  const typing = useRef<ReturnType<typeof holdTyping>>(undefined);
  // What was typed goes nowhere else, so nothing reaches the conversation being left. The focus does not go back to the button: the next Space would press New again, and a create that works would take the rest of the text as a partial message.
  const dropTyping = useCallback(() => {
    const held = typing.current;
    typing.current = undefined;
    held?.field?.remove();
  }, []);
  useEffect(() => dropTyping, [dropTyping]);
  const openedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markOpened = useCallback((id: string | undefined) => {
    clearTimeout(openedTimer.current);
    if (id !== undefined) openedTimer.current = setTimeout(() => { dropTyping(); setOpened(undefined); }, OPENED_MS);
    else dropTyping();
    setOpened(id);
  }, [dropTyping]);
  // The New or fork on its way; forgetting it gives the composer back, and its late answer then moves nobody.
  const opening = useRef<object | undefined>(undefined);
  const forget = useCallback(() => { opening.current = undefined; setCreating(false); }, []);
  const base = endpoint === undefined ? undefined : String(endpoint);
  const latest = useRef({ fetch, onSelect, onChange, activeId, openTimeoutMs, base });
  useLayoutEffect(() => { latest.current = { fetch, onSelect, onChange, activeId, openTimeoutMs, base }; });
  // The text is not given back: it stays out of the draft being left, and the message says it is gone.
  const failNew = useCallback(() => {
    setFailedNew({ at: latest.current.activeId, typed: Boolean(typing.current?.field?.value) });
    dropTyping();
  }, [dropTyping]);
  const call = useCallback(async (params: Record<string, string>, body?: unknown, signal?: AbortSignal) => {
    if (base === undefined) throw new Error('No conversations endpoint');
    const url = new URL(base, globalThis.location?.href);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const init: RequestInit = body === undefined ? { ...(signal ? { signal } : {}) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) };
    const response = await latest.current.fetch(new Request(url, init));
    if (!response.ok) throw new Error(`Conversations: ${response.status}`);
    return await response.json() as { conversations?: readonly ServedConversation[]; conversationId?: number | string };
  }, [base]);
  // Lists can answer out of order: an older answer must not overwrite a newer one, or a conversation just created leaves the list again.
  const asked = useRef(0);
  const shown = useRef(0);
  const list = useCallback(async (live: () => boolean = () => true) => {
    const turn = ++asked.current;
    const result = await call({});
    if (!live() || turn < shown.current) return;
    shown.current = turn;
    setItems((result.conversations ?? []).map(item));
  }, [call]);
  const reload = useCallback(() => list(), [list]);
  // Another endpoint (another owner's list) starts empty; switching conversations only reloads.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a new endpoint clears the old owner's list once, after commit
  useEffect(() => { setItems(undefined); setFailedNew(undefined); markOpened(undefined); forget(); }, [base, forget, markOpened]);
  useEffect(() => {
    if (base === undefined) return;
    let off = false;
    const load = () => list(() => !off).catch(() => {});
    void load();
    const timer = setInterval(load, pollMs);
    return () => { off = true; clearInterval(timer); };
  }, [base, list, pollMs, activeId]);
  return useMemo(() => {
    if (!items) return undefined;
    const changed = async () => { await reload().catch(() => {}); await latest.current.onChange?.(); };
    const op = (name: string, body: unknown) => call({ op: name }, body);
    // Selects last: a host may open a conversation only once its list holds it. Until then a message would go to the conversation being left.
    const open = async (name: string, body: unknown) => {
      if (opening.current) return;
      const gaveUp = name === 'create' ? failNew : dropTyping;
      const run = {};
      opening.current = run;
      setCreating(true);
      const timer = setTimeout(() => { if (opening.current === run) { forget(); gaveUp(); } }, latest.current.openTimeoutMs);
      let selected = false;
      try {
        const { conversationId } = await op(name, body);
        await changed();
        if (conversationId !== undefined && opening.current === run) { selected = true; markOpened(String(conversationId)); latest.current.onSelect(String(conversationId)); }
        // Nobody waits for it any more, so it would stay in the list as an empty row, unless the person already opened it. Another owner's list is not this one's to change.
        else if (name === 'create' && conversationId !== undefined && latest.current.base === base && latest.current.activeId !== String(conversationId)) { await op('delete', { conversationId }); await changed(); }
      } finally {
        clearTimeout(timer);
        if (opening.current === run) { forget(); if (!selected) gaveUp(); }
      }
    };
    return {
      items, activeId, creating, opened, reload,
      newFailed: failedNew && failedNew.at === activeId ? { typed: failedNew.typed } : undefined,
      newFailedSeen: () => setFailedNew(undefined),
      openedSeen: () => {
        const typed = typing.current?.field?.value ?? '';
        typing.current?.field?.remove();
        typing.current = undefined;
        markOpened(undefined);
        return typed;
      },
      onSelect: (id: string) => { forget(); setFailedNew(undefined); markOpened(undefined); latest.current.onSelect(id); },
      onNew: () => {
        if (!opening.current) { setFailedNew(undefined); markOpened(undefined); typing.current = holdTyping(); }
        else typing.current?.field?.focus();
        void open('create', {}).catch(() => {});
      },
      search: async (query: string, { archived }: { readonly archived: boolean }, signal: AbortSignal) =>
        ((await call({ ...(query ? { q: query } : {}), ...(archived ? { archived: '1' } : {}) }, undefined, signal)).conversations ?? []).map(item),
      rename: async (id: string, title: string) => { await op('rename', { conversationId: id, title }); await changed(); },
      archive: async (id: string, archived: boolean) => { await op('archive', { conversationId: id, archived }); await changed(); },
      remove: async (id: string) => { await op('delete', { conversationId: id }); await changed(); },
      fork: async (at: string) => {
        const from = latest.current.activeId;
        if (from === undefined) return;
        await open('fork', { conversationId: from, at });
      },
    };
  }, [items, activeId, creating, opened, failedNew, base, call, reload, forget, markOpened, dropTyping, failNew]);
}

/** Compatibility spelling retained for one release. */
export const useConversations = useConversationsClient;
