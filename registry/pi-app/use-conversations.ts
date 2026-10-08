import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationItem, ConversationsConfig } from '../pi-chat/pi-chat';

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
export function useConversations({ endpoint, fetch, activeId, onSelect, onChange, pollMs = 4000 }: {
  /** Undefined: nothing is listed yet (for example while the host is still loading). */
  readonly endpoint: string | URL | undefined;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly activeId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onChange?: (() => void | Promise<void>) | undefined;
  readonly pollMs?: number;
}): (ConversationsConfig & { readonly reload: () => Promise<void> }) | undefined {
  const [items, setItems] = useState<readonly ConversationItem[] | undefined>();
  const latest = useRef({ fetch, onSelect, onChange, activeId });
  latest.current = { fetch, onSelect, onChange, activeId };
  const base = endpoint === undefined ? undefined : String(endpoint);
  const call = useCallback(async (params: Record<string, string>, body?: unknown, signal?: AbortSignal) => {
    if (base === undefined) throw new Error('No conversations endpoint');
    const url = new URL(base, globalThis.location?.href);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const init: RequestInit = body === undefined ? { ...(signal ? { signal } : {}) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) };
    const response = await latest.current.fetch(new Request(url, init));
    if (!response.ok) throw new Error(`Conversations: ${response.status}`);
    return await response.json() as { conversations?: readonly ServedConversation[]; conversationId?: number | string };
  }, [base]);
  const reload = useCallback(async () => { const result = await call({}); setItems((result.conversations ?? []).map(item)); }, [call]);
  // Another endpoint (another owner's list) starts empty; switching conversations only reloads.
  useEffect(() => { setItems(undefined); }, [base]);
  useEffect(() => {
    if (base === undefined) return;
    let off = false;
    const load = () => call({}).then(result => { if (!off) setItems((result.conversations ?? []).map(item)); }).catch(() => {});
    void load();
    const timer = setInterval(load, pollMs);
    return () => { off = true; clearInterval(timer); };
  }, [call, pollMs, activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!items) return undefined;
    const changed = async () => { await reload().catch(() => {}); await latest.current.onChange?.(); };
    const op = (name: string, body: unknown) => call({ op: name }, body);
    return {
      items, activeId, reload,
      onSelect: (id: string) => latest.current.onSelect(id),
      onNew: () => { void op('create', {}).then(async result => { await changed(); if (result.conversationId !== undefined) latest.current.onSelect(String(result.conversationId)); }).catch(() => {}); },
      search: async (query: string, { archived }: { readonly archived: boolean }, signal: AbortSignal) =>
        ((await call({ ...(query ? { q: query } : {}), ...(archived ? { archived: '1' } : {}) }, undefined, signal)).conversations ?? []).map(item),
      rename: async (id: string, title: string) => { await op('rename', { conversationId: id, title }); await changed(); },
      archive: async (id: string, archived: boolean) => { await op('archive', { conversationId: id, archived }); await changed(); },
      remove: async (id: string) => { await op('delete', { conversationId: id }); await changed(); },
      fork: async (at: string) => {
        const from = latest.current.activeId;
        if (from === undefined) return;
        const { conversationId } = await op('fork', { conversationId: from, at });
        await changed();
        if (conversationId !== undefined) latest.current.onSelect(String(conversationId));
      },
    };
  }, [items, activeId, call, reload]);
}
