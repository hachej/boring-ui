'use client';

// The client of a host's Spaces service. The host checks membership and role on every call; this only names the space.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const change = (input: Record<string, unknown>) => ({ ...input, idempotencyKey: crypto.randomUUID() });

/** The link a manager sends: this page with the invitation in its address. The host signs the person in first and keeps the query. */
export const spaceInviteLink = (token: string, inviteParam = 'invite'): string => {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = `?${inviteParam}=${encodeURIComponent(token)}`;
  return url.href;
};

/** The person's spaces of one kind: the list, the current one (remembered per kind on this device), create, members, and the invitation in the address. */
export function useSpaces({ kind, transport, labels = spacesLabels, inviteParam = 'invite' }: UseSpacesOptions) {
  const remembered = `space:${kind}`;
  const [spaces, setSpaces] = useState<readonly SpaceSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() => { try { return localStorage.getItem(remembered); } catch { return null; } });
  const [error, setError] = useState<string | null>(null);
  const words = useRef(labels);
  useEffect(() => { words.current = labels; }, [labels]);
  const refresh = useCallback(async () => {
    try {
      const { spaces: list } = await transport<{ spaces: SpaceSummary[] }>('spaces.list', { kind });
      setSpaces(list);
      setSelected(id => (id && list.some(space => space.id === id) ? id : list[0]?.id ?? null));
    } catch (problem) { setError(spaceErrorMessage(problem, words.current)); }
  }, [kind, transport]);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get(inviteParam);
    // Removed from the address at once, so a second run of this effect (Strict Mode, a new transport) cannot use the one-time token again.
    if (token) {
      const url = new URL(window.location.href);
      url.searchParams.delete(inviteParam);
      window.history.replaceState(window.history.state, '', url.href);
    }
    const accept = token
      ? transport<{ space: SpaceSummary }>('invites.accept', change({ token })).then(({ space }) => setSelected(space.id), problem => setError(spaceErrorMessage(problem, words.current)))
      : Promise.resolve();
    void accept.then(refresh);
  }, [refresh, transport, inviteParam]);
  useEffect(() => { try { if (selected) localStorage.setItem(remembered, selected); } catch { /* private mode: not remembered */ } }, [selected, remembered]);
  const create = useCallback(async (title: string) => {
    const { space } = await transport<{ space: SpaceSummary }>('spaces.create', change({ kind, title }));
    await refresh();
    setSelected(space.id);
    return space;
  }, [kind, transport, refresh]);
  const read = useCallback((space: string) => transport<SpaceView>('spaces.get', { space }), [transport]);
  const invite = useCallback(async (space: string, email: string, role: string) => {
    const { invite: created } = await transport<{ invite: { token: string; expiresAt: string } }>('members.invite', change({ space, email, role }));
    return { ...created, link: spaceInviteLink(created.token, inviteParam) };
  }, [transport, inviteParam]);
  const setRole = useCallback((space: string, person: string, role: string) => transport<unknown>('members.setRole', change({ space, person, role })), [transport]);
  const remove = useCallback((space: string, person: string) => transport<unknown>('members.remove', change({ space, person })), [transport]);
  const leave = useCallback((space: string) => transport<unknown>('members.leave', change({ space })), [transport]);
  const select = useCallback((id: string) => setSelected(id), []);
  return useMemo(() => ({
    spaces, current: spaces?.find(space => space.id === selected) ?? null, error, select, create, refresh, read, invite, setRole, remove, leave,
  }), [spaces, selected, error, select, create, refresh, read, invite, setRole, remove, leave]);
}
