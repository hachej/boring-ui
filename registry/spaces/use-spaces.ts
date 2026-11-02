'use client';

// The client of a host's Spaces service. The host checks membership and role on every call; this only names the space.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from '@hachej/boring-files/platform';
import { spaceErrorMessage, spacesLabels } from './spaces-labels';
import type { SpacesLabels } from './spaces-labels';

export type SpaceSummary = { readonly id: string; readonly kind: string; readonly title: string; readonly role: string };
export type SpaceMember = { readonly person?: string; readonly name: string; readonly role: string; readonly since?: string };
export type SpaceInvite = { readonly id: string; readonly role: string; readonly expiresAt: string; readonly by: string };
export type SpaceAdminAccess = { readonly by: string; readonly at: string; readonly reason: string; readonly write: boolean; readonly until: string };
/** A guest sees the managers only; managers also get the open invites and every administrator access. */
export type SpaceView = { readonly space: SpaceSummary & { readonly orphaned: boolean }; readonly members: readonly SpaceMember[]; readonly invites?: readonly SpaceInvite[]; readonly access?: readonly SpaceAdminAccess[] };
export type SpaceRoleOption = { readonly id: string; readonly label: string; readonly manage?: boolean };

/** One operation of the host's Spaces service, for example `(operation, input) => api(`_spaces/${operation}`, { body: input })`. */
export type SpacesTransport = <T>(operation: string, input: Record<string, unknown>) => Promise<T>;

export interface UseSpacesOptions {
  /** The kind of space to list and create. */
  readonly kind: string;
  /** Keep it stable: a new function reads the list again. */
  readonly transport: SpacesTransport;
  readonly labels?: SpacesLabels;
  /** The address parameter of an invitation, accepted once and then removed (default `invite`). */
  readonly inviteParam?: string;
}

/** A change carries a fresh idempotency key: a retry of the same call is the same change. */
const change = (input: Record<string, unknown>) => ({ ...input, idempotencyKey: randomUUID() });

const rememberedKey = (kind: string) => `space:${kind}`;
const remembered = (kind: string): string | null => { try { return localStorage.getItem(rememberedKey(kind)); } catch { return null; } };

/** The link a manager sends: this page with the invitation in its address. The host signs the person in first and keeps the query. */
export const spaceInviteLink = (token: string, inviteParam = 'invite'): string => {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = `?${inviteParam}=${encodeURIComponent(token)}`;
  return url.href;
};

/** The person's spaces of one kind: the list, the current one (remembered per kind on this device), create, members, and the invitation in the address. */
export function useSpaces({ kind, transport, labels = spacesLabels, inviteParam = 'invite' }: UseSpacesOptions) {
  const [listed, setListed] = useState<{ readonly kind: string; readonly spaces: readonly SpaceSummary[] } | null>(null);
  // One choice per kind; a kind not chosen yet starts from what this device remembers.
  const [picks, setPicks] = useState<Readonly<Record<string, string | null>>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const spaces = listed?.kind === kind ? listed.spaces : null;
  const picked = Object.hasOwn(picks, kind);
  const selected = picked ? picks[kind] ?? null : remembered(kind);
  const words = useRef(labels);
  useEffect(() => { words.current = labels; }, [labels]);
  const accepting = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    // A list read before an invitation is accepted would not hold the space it opens, and only the last list asked for counts.
    await accepting.current;
    try {
      const { spaces: list } = await transport<{ spaces: SpaceSummary[] }>('spaces.list', { kind });
      if (ticket !== latest.current) return;
      setListError(null);
      setListed({ kind, spaces: list });
      setPicks(current => {
        const id = Object.hasOwn(current, kind) ? current[kind] ?? null : remembered(kind);
        return { ...current, [kind]: id && list.some(space => space.id === id) ? id : list[0]?.id ?? null };
      });
    } catch (problem) { if (ticket === latest.current) setListError(spaceErrorMessage(problem, words.current)); }
  }, [kind, transport]);
  const select = useCallback((id: string) => setPicks(current => ({ ...current, [kind]: id })), [kind]);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get(inviteParam);
    // Removed from the address at once, so a second run of this effect (Strict Mode, a new transport) cannot use the one-time token again.
    if (token) {
      const url = new URL(window.location.href);
      url.searchParams.delete(inviteParam);
      window.history.replaceState(window.history.state, '', url.href);
      accepting.current = transport<{ space: SpaceSummary }>('invites.accept', change({ token }))
        .then(({ space }) => { setInviteError(null); select(space.id); }, problem => setInviteError(spaceErrorMessage(problem, words.current)));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the host's list on mount: its state is set after the await, never synchronously
    void refresh();
  }, [refresh, select, transport, inviteParam]);
  useEffect(() => { try { if (picked && selected) localStorage.setItem(rememberedKey(kind), selected); } catch { /* private mode: not remembered */ } }, [picked, selected, kind]);
  const create = useCallback(async (title: string) => {
    const { space } = await transport<{ space: SpaceSummary }>('spaces.create', change({ kind, title }));
    await refresh();
    select(space.id);
    return space;
  }, [kind, transport, refresh, select]);
  const read = useCallback((space: string) => transport<SpaceView>('spaces.get', { space }), [transport]);
  const invite = useCallback(async (space: string, email: string, role: string) => {
    const { invite: created } = await transport<{ invite: { token: string; expiresAt: string } }>('members.invite', change({ space, email, role }));
    return { ...created, link: spaceInviteLink(created.token, inviteParam) };
  }, [transport, inviteParam]);
  const setRole = useCallback((space: string, person: string, role: string) => transport<unknown>('members.setRole', change({ space, person, role })), [transport]);
  const remove = useCallback((space: string, person: string) => transport<unknown>('members.remove', change({ space, person })), [transport]);
  const leave = useCallback((space: string) => transport<unknown>('members.leave', change({ space })), [transport]);
  const error = listError ?? inviteError;
  return useMemo(() => ({
    spaces, current: spaces?.find(space => space.id === selected) ?? null, error, select, create, refresh, read, invite, setRole, remove, leave,
  }), [spaces, selected, error, select, create, refresh, read, invite, setRole, remove, leave]);
}
