// Sign-in for one app, as one object its Worker calls: `handle` answers the sign-in routes (undefined for the app's own), `personOf` and
// `mcpPerson` say who is asking, `mcpRefusal` is the 401 that sends an assistant to sign in, and Studio's `linkApp` registers an app's
// client for the round trip. Routes, all under the app's origin:
//   /api/auth/*                        Better Auth (sign-up, sign-in, sign-out, OAuth provider), refusals in the person's language
//   /.well-known/oauth-*               discovery for assistants (RFC 9728, RFC 8414, OpenID)
//   /api/signin/options, /me           what the sign-in page offers; who is signed in, with the « Studio » entry for an app's owners
//   /api/signin/first-owner            GET with the link's token (x-boring-first-owner): { valid }, false for a used or an unknown link
//   /api/signin/people                 the invitation list, owners only
//   /api/signin/studio                 an app linked to Studio: the round trip that proves an owner
//   /api/signin/owners                 Studio: its signed owner list
//   /api/signin/links                  Studio: an owner links an app (registers its client for the round trip)
import { createLocalJWKSet, jwtVerify } from 'jose';
import { makeAuth, MCP_SCOPES, normalEmail, type Person, type Role, type SignInOptions } from './auth.js';
import { OWNERS_AUDIENCE, STUDIO, STUDIO_SCOPES, studioCallback } from './studio.js';
import { inWords, langOf, refuse } from './words.js';

export type { Person, Role, SignInOptions } from './auth.js';
export type { StudioClientOptions } from './studio.js';
export { MCP_SCOPES } from './auth.js';
export { langOf, say, type Lang } from './words.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const loopback = (u: string) => { try { const x = new URL(u); return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname); } catch { return false; } };
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function signIn(options: SignInOptions) {
  const a = makeAuth(options);
  const { auth, origin, ready } = a;
  const api = auth.api as unknown as Record<string, (input: unknown) => Promise<unknown>>;
  const db = a.adapter;
  type User = { id: string; email: string; name: string };
  const withRole = async (user: User | null | undefined): Promise<Person | undefined> => {
    const role = user ? await a.roleOf(user) : undefined;
    return user && role ? { id: user.id, email: user.email, name: user.name, role } : undefined;
  };

  /** The signed-in person behind a session cookie (or bearer session), with their role; undefined when nobody, or on no list. */
  const personOf = async (request: Request): Promise<Person | undefined> => {
    await ready();
    const s = await api['getSession']!({ headers: request.headers }).catch(() => null) as { user: User } | null;
    return withRole(s?.user);
  };

  /** The person an MCP bearer token stands for (a token this app issued for `<origin>/mcp`), or nobody. */
  const mcpPerson = async (request: Request): Promise<Person | undefined> => {
    await ready();
    const header = request.headers.get('authorization') ?? '';
    if (!header.startsWith('Bearer ')) return undefined;
    // The signing keys come from Better Auth directly: a Worker cannot fetch its own address.
    const jwks = await (await auth.handler(new Request(`${origin}/api/auth/jwks`))).json() as { keys: never[] };
    const claims = await jwtVerify(header.slice(7), createLocalJWKSet(jwks as never), { issuer: `${origin}/api/auth`, audience: `${origin}/mcp` })
      .then((r) => r.payload, () => undefined);
    return claims?.sub ? withRole(await (await db()).findOne<User>({ model: 'user', where: [{ field: 'id', value: claims.sub }] })) : undefined;
  };

  const mcpRefusal = (request: Request) => refuse('MCP_TOKEN', 401, langOf(request), {
    'access-control-allow-origin': '*', 'access-control-expose-headers': 'www-authenticate',
    'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  });

  /** The invitation list, for owners: GET lists, POST {email, role} invites, DELETE ?email= removes (and so ends that person's access). */
  const people = async (request: Request, url: URL): Promise<Response> => {
    const lang = langOf(request);
    const me = await personOf(request);
    if (!me) return refuse('SIGN_IN_FIRST', 401, lang);
    if (me.role !== 'owner') return refuse('OWNERS_ONLY', 403, lang);
    const store = await db();
    if (request.method === 'GET') {
      const list = await store.findMany<{ email: string; role: string; invitedBy: string; createdAt: Date }>({ model: 'invitation', sortBy: { field: 'createdAt', direction: 'asc' } });
      return Response.json({ people: list.map(({ email, role, invitedBy, createdAt }) => ({ email, role, invitedBy, at: createdAt })) });
    }
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { email?: unknown; role?: unknown };
      const email = typeof body.email === 'string' ? normalEmail(body.email) : '';
      if (!EMAIL.test(email)) return refuse('BAD_EMAIL', 400, lang);
      // In an app linked to Studio, owners come from Studio only: its own list holds members.
      const role: Role = body.role === 'owner' && !a.link ? 'owner' : 'member';
      const where = [{ field: 'email', value: email }];
      if (await store.findOne({ model: 'invitation', where })) await store.update({ model: 'invitation', where, update: { role, invitedBy: me.email } });
      else await store.create({ model: 'invitation', data: { email, role, invitedBy: me.email, createdAt: new Date() } });
      return Response.json({ invited: email, role }, { status: 201 });
    }
    if (request.method === 'DELETE') {
      const email = normalEmail(url.searchParams.get('email') ?? '');
      await store.delete({ model: 'invitation', where: [{ field: 'email', value: email }] });
      return Response.json({ removed: email });
    }
    return new Response(null, { status: 405 });
  };

  /** Studio: its owners, by Studio id only (the route is public, so no address or name), in a 5-minute token signed with its own keys. */
  const owners = async (): Promise<Response> => {
    await ready();
    const store = await db();
    const rows = await store.findMany<{ email: string }>({ model: 'invitation', where: [{ field: 'role', value: 'owner' }] });
    const users = (await Promise.all(rows.map((r) => store.findOne<User>({ model: 'user', where: [{ field: 'email', value: r.email }] })))).filter((u): u is User => !!u);
    const { token } = await api['signJWT']!({ body: {
      payload: { owners: users.map((u) => ({ sub: u.id })) },
      overrideOptions: { jwt: { issuer: `${origin}/api/auth`, audience: OWNERS_AUDIENCE, expirationTime: '5m' } },
    } }) as { token: string };
    return Response.json({ token }, { headers: { 'cache-control': 'no-store' } });
  };

  /** An app linked to Studio: start the round trip (Better Auth's genericOAuth), keeping its state cookie, then on to Studio. */
  const toStudio = async (request: Request): Promise<Response> => {
    await ready();
    const headers = new Headers({ 'content-type': 'application/json', origin, cookie: request.headers.get('cookie') ?? '' });
    // The person's address, for Better Auth's limiter: without it every round trip would share one bucket.
    for (const name of ['cf-connecting-ip', 'x-forwarded-for']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    const r = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, { method: 'POST', headers, body: JSON.stringify({ provider: STUDIO, callbackURL: '/', errorCallbackURL: '/sign-in' }) }));
    const { url } = await r.clone().json().catch(() => ({})) as { url?: string };
    if (!url) return inWords(r, langOf(request));
    const out = new Headers({ location: url });
    for (const c of r.headers.getSetCookie()) out.append('set-cookie', c);
    return new Response(null, { status: 302, headers: out });
  };

  /** Whether a first-owner token is good now: it is the link's (`firstOwnerHash`) and no owner exists yet. Reads only; it never uses the link up. */
  const linkOpen = async (token: string | null): Promise<boolean> =>
    !!token && !!options.firstOwnerHash && await sha256(token) === options.firstOwnerHash.toLowerCase() && !await a.hasOwner();

  /** The sign-in page's check of `/sign-in?first-owner=<token>`: `{ valid }`, one answer for a used link and an unknown one, any number of times. */
  const firstOwnerCheck = async (request: Request): Promise<Response> => {
    await ready();
    return Response.json({ valid: await linkOpen(request.headers.get('x-boring-first-owner')) }, { headers: { 'cache-control': 'no-store' } });
  };

  /** The first-owner link's token on a sign-up: while no owner exists, its holder may sign up and becomes the owner. */
  const firstOwner = async (request: Request): Promise<void> => {
    if (!await linkOpen(request.headers.get('x-boring-first-owner'))) return;
    const body = await request.clone().json().catch(() => ({})) as { email?: unknown };
    if (typeof body.email === 'string') a.pending.firstOwner = normalEmail(body.email);
  };

  /** The sign-in routes; undefined for any other path, which stays the app's. */
  const handle = async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const lang = langOf(request);
    const path = url.pathname;
    if (path === '/api/signin/options') return Response.json({ google: !!options.google, studio: !!a.link, app: options.appName });
    if (path === '/api/signin/me') {
      const me = await personOf(request);
      return me ? Response.json({ person: me, ...(a.link && me.role === 'owner' ? { studio: a.link.entry } : {}) }) : refuse('SIGN_IN_FIRST', 401, lang);
    }
    if (path === '/api/signin/first-owner') return request.method === 'GET' ? firstOwnerCheck(request) : new Response(null, { status: 405 });
    if (path === '/api/signin/people') return people(request, url);
    if (path === '/api/signin/owners' && options.provider) return owners();
    if (path === '/api/signin/links' && options.provider && request.method === 'POST') return links(request);
    if (path === '/api/signin/studio' && a.link) return toStudio(request);
    // An assistant registers itself: one whose callbacks are all http on loopback (Claude Code, any port) is a native client, since
    // Better Auth refuses http callbacks for web clients.
    if (path === '/api/auth/oauth2/register' && request.method === 'POST') {
      await ready();
      const { metadata: _dropped, ...body } = await request.json().catch(() => ({})) as { redirect_uris?: string[]; metadata?: unknown };
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      const native = uris.length > 0 && uris.every(loopback);
      const inner = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ ...body, token_endpoint_auth_method: 'none', ...(native ? { application_type: 'native' } : {}) }) });
      return inWords(await auth.handler(inner), lang);
    }
    if (path.startsWith('/api/auth/')) {
      await ready();
      if (path === '/api/auth/sign-up/email' && request.method === 'POST') await firstOwner(request);
      return inWords(await auth.handler(request), lang);
    }
    // OAuth discovery for assistants: the protected resource (RFC 9728) and the authorization server's metadata (RFC 8414, OIDC).
    if (/^\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(path)) {
      return Response.json({ resource: `${origin}/mcp`, authorization_servers: [`${origin}/api/auth`], scopes_supported: MCP_SCOPES, bearer_methods_supported: ['header'], resource_name: options.appName },
        { headers: { 'access-control-allow-origin': '*' } });
    }
    const server = /^\/\.well-known\/(oauth-authorization-server|openid-configuration)(\/api\/auth)?$/.exec(path);
    if (server) { await ready(); const inner = new URL(url); inner.pathname = `/api/auth/.well-known/${server[1]}`; return auth.handler(new Request(inner, request)); }
    return undefined;
  };

  /** Studio: register (once) the client of an app's round trip, as an owner (`headers` carry their session); answers its client id. */
  const linkApp = async (headers: Headers, app: string, appOrigin: string): Promise<string> => {
    await ready();
    const name = `studio-link:${app}`;
    const known = await (await db()).findOne<{ clientId: string }>({ model: 'oauthClient', where: [{ field: 'name', value: name }] });
    if (known) return known.clientId;
    const created = await api['adminCreateOAuthClient']!({ headers, body: {
      client_name: name, redirect_uris: [studioCallback(appOrigin)], token_endpoint_auth_method: 'none', require_pkce: true, skip_consent: true,
      grant_types: ['authorization_code'], response_types: ['code'], scope: STUDIO_SCOPES.join(' '),
    } }) as { client_id: string };
    return created.client_id;
  };

  /** Studio: POST {app, origin} links an app, owners only; answers the client id the app's stack is given. */
  const links = async (request: Request): Promise<Response> => {
    const lang = langOf(request);
    const me = await personOf(request);
    if (!me) return refuse('SIGN_IN_FIRST', 401, lang);
    if (me.role !== 'owner') return refuse('OWNERS_ONLY', 403, lang);
    const body = await request.json().catch(() => ({})) as { app?: unknown; origin?: unknown };
    if (typeof body.app !== 'string' || !/^[a-z0-9-]{1,40}$/.test(body.app) || typeof body.origin !== 'string' || !URL.canParse(body.origin)) return new Response(null, { status: 400 });
    return Response.json({ app: body.app, clientId: await linkApp(request.headers, body.app, body.origin) });
  };

  return { handle, personOf, mcpPerson, mcpRefusal, linkApp, auth };
}

export type SignIn = ReturnType<typeof signIn>;
