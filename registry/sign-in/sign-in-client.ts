// The page's side of `@hachej/boring-ui-kit/signin`: plain fetches to the app's own sign-in routes, the person's language sent along so
// refusals come back in it. No state here; the pages and `useSignedIn` hold it.

import { signInLabels, type Lang } from './sign-in-labels';

export type { Lang };
export interface Person { readonly id: string; readonly email: string; readonly name: string; readonly role: 'owner' | 'member' }
export interface Me { readonly person: Person; readonly studio?: string }
export interface Options { readonly google: boolean; readonly studio: boolean; readonly app: string }
export interface Invitation { readonly email: string; readonly role: 'owner' | 'member'; readonly invitedBy: string; readonly at: string }

type Reply = { readonly message?: string; readonly url?: string; readonly redirect_uri?: string } & Record<string, unknown>;

async function call(lang: Lang, path: string, init: RequestInit & { readonly extra?: Record<string, string> } = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'x-boring-lang': lang, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.extra };
  const r = await fetch(path, { ...init, credentials: 'same-origin', headers });
  const data = await r.json().catch(() => ({})) as Reply;
  if (!r.ok) throw new Error(data.message ?? signInLabels[lang].failed);
  return data;
}

export const signInClient = (lang: Lang) => ({
  options: () => call(lang, '/api/signin/options') as Promise<unknown> as Promise<Options>,
  /** Whether the one-use first-owner link is still good: the Worker answers `{ valid }`, the same for a used link and an unknown one. */
  firstOwnerValid: (token: string) => call(lang, '/api/signin/first-owner', { extra: { 'x-boring-first-owner': token } }).then(r => r.valid === true),
  /** The signed-in person, or null. */
  me: () => call(lang, '/api/signin/me').then(r => r as unknown as Me, () => null),
  signIn: (email: string, password: string) => call(lang, '/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) }),
  /** By invitation; `firstOwner` is the one-use link's token when the person opened that link. */
  signUp: (name: string, email: string, password: string, firstOwner?: string) =>
    call(lang, '/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ name: name || email, email, password }), ...(firstOwner ? { extra: { 'x-boring-first-owner': firstOwner } } : {}) }),
  signOut: () => call(lang, '/api/auth/sign-out', { method: 'POST', body: '{}' }),
  google: () => call(lang, '/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/sign-in' }) }),
  /** Signed in during an assistant's authorization: resume it (to /consent, or straight back to the assistant). */
  resume: (query: string) => call(lang, '/api/auth/oauth2/continue', { method: 'POST', body: JSON.stringify({ postLogin: true, oauth_query: query }) }),
  consent: (accept: boolean, scope: string, query: string) => call(lang, '/api/auth/oauth2/consent', { method: 'POST', body: JSON.stringify({ accept, scope, oauth_query: query }) }),
  people: () => call(lang, '/api/signin/people').then(r => (r as unknown as { people: Invitation[] }).people),
  invite: (email: string, role: 'owner' | 'member') => call(lang, '/api/signin/people', { method: 'POST', body: JSON.stringify({ email, role }) }),
  uninvite: (email: string) => call(lang, `/api/signin/people?email=${encodeURIComponent(email)}`, { method: 'DELETE' }),
});

/** The signed query Better Auth put on /sign-in or /consent during an assistant's authorization, or '' on an ordinary visit. */
export const authorizationQuery = (): string =>
  (location.pathname === '/sign-in' || location.pathname === '/consent') && new URLSearchParams(location.search).has('client_id') ? location.search.slice(1) : '';

/** The one-use first-owner token, from `/sign-in?first-owner=<token>`, or ''. */
export const firstOwnerToken = (): string => new URLSearchParams(location.search).get('first-owner') ?? '';

/** Leave for the address an OAuth answer names; false when it names none. */
export const follow = (reply: Reply): boolean => { const to = reply.redirect_uri ?? reply.url; if (to) location.assign(to); return !!to; };
