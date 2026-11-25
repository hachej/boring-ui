// The two Workers of the sign-in tests (a Studio and an app, each on an in-memory node:sqlite database), the browser that talks to them, and the
// assistant's OAuth sign-in: shared by the sign-in tests. Fictional people only.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getCurrentAuthContextAsyncLocalStorage, getCurrentDBAdapterAsyncLocalStorage, getRequestStateAsyncLocalStorage } from '@better-auth/core/context';
import { signIn } from '@hachej/boring-ui-kit/signin';
import { resetSignInCaches } from '@hachej/boring-ui-kit/signin/testing';

export const STUDIO = 'https://studio.test', APP = 'https://app.test';
export const password = 'correct horse battery';
export const secret = () => randomBytes(32).toString('hex');
export const link = () => { const token = randomBytes(32).toString('base64url'); return { token, hash: createHash('sha256').update(token).digest('hex') }; };

/** One browser: a cookie jar per origin, each request served by the instance that owns its origin. */
export function browser(route) {
  const jars = new Map();
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
  const go = async (input, init = {}) => {
    const url = new URL(input);
    const jar = jars.get(url.origin) ?? new Map();
    jars.set(url.origin, jar);
    const headers = new Headers(init.headers);
    headers.set('origin', url.origin);
    headers.set('cf-connecting-ip', ip);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    let body = init.body;
    if (body && typeof body === 'object' && !(body instanceof URLSearchParams)) { body = JSON.stringify(body); headers.set('content-type', 'application/json'); }
    const r = await route(new Request(url, { ...init, body, headers, redirect: 'manual' }));
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) jar.set(pair.slice(0, i), v); else jar.delete(pair.slice(0, i)); }
    return r;
  };
  return { go, anonymous: () => browser(route), json: async (input, init) => { const r = await go(input, init); return { status: r.status, body: await r.json().catch(() => ({})), r }; } };
}

export const signUp = (b, origin, email, extra = {}) => b.json(`${origin}/api/auth/sign-up/email`, { method: 'POST', body: { email, password, name: email.split('@')[0] }, headers: extra });
export const me = async (b, origin) => (await b.json(`${origin}/api/signin/me`));

/** A Studio and, once linked, an app; requests are routed by origin, as the two Workers would serve them. */
export function world() {
  const first = link();
  const studio = signIn({ database: new DatabaseSync(':memory:'), secret: secret(), origin: STUDIO, appName: 'Studio', firstOwnerHash: first.hash, provider: true });
  // Two Workers in one process: Studio must not see the app's Better Auth request and transaction (async local storage), as it would not on Cloudflare.
  const studioFetch = async (input, init) => {
    const stores = await Promise.all([getCurrentDBAdapterAsyncLocalStorage(), getCurrentAuthContextAsyncLocalStorage(), getRequestStateAsyncLocalStorage()]);
    const outside = stores.reduce((run, store) => () => store.exit(run), () => studio.handle(new Request(input, init)));
    return (await outside()) ?? new Response('not found', { status: 404 });
  };
  let app;
  const route = async (request) => (new URL(request.url).origin === STUDIO ? studio : app).handle(request).then((r) => r ?? new Response('page', { status: 200 }));
  // A new app Worker is a new isolate: the kit keeps its sign-in per isolate and database.
  const makeApp = (extra) => (resetSignInCaches(), app = signIn({ database: new DatabaseSync(':memory:'), secret: secret(), origin: APP, appName: 'Demo', ...extra }));
  return { studio, route, first, makeApp, studioFetch };
}

/** The authorization-code dance with PKCE, as an assistant does it, in a browser signed in to the server. */
export async function authorize(b, server, { clientId, redirectUri, scope, resource }) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope, state: 'st', code_challenge: challenge, code_challenge_method: 'S256', resource });
  const r = await b.go(`${server}/api/auth/oauth2/authorize?${q}`);
  let at = new URL(r.headers.get('location') ?? '', server);
  if (at.pathname === '/consent') {
    const reply = await b.json(`${server}/api/auth/oauth2/consent`, { method: 'POST', body: { accept: true, scope, oauth_query: at.search.slice(1) } });
    at = new URL(reply.body.redirect_uri ?? reply.body.url);
  }
  return { code: at.searchParams.get('code'), verifier };
}

/** An assistant's own sign-in to the app's /mcp, as the person in browser `b`: registers a loopback client (as an assistant does, signed in to nothing), authorizes with PKCE, answers the access token. */
export async function assistantToken(b, server) {
  const redirectUri = 'http://localhost:4545/callback', scope = 'openid profile email offline_access', resource = `${server}/mcp`;
  const reg = await b.anonymous().json(`${server}/api/auth/oauth2/register`, { method: 'POST', body: { redirect_uris: [redirectUri], client_name: 'Claude Code' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const { code, verifier } = await authorize(b, server, { clientId: reg.body.client_id, redirectUri, scope, resource });
  assert.ok(code, 'the person allowed the assistant');
  const token = await b.json(`${server}/api/auth/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: reg.body.client_id, code_verifier: verifier, resource }) });
  assert.equal(token.status, 200, JSON.stringify(token.body));
  return token.body.access_token;
}

/** The « Studio » round trip: the app sends the browser to Studio, which sends it back with a code. */
export async function throughStudio(b) {
  const start = await b.go(`${APP}/api/signin/studio`);
  assert.equal(start.status, 302);
  const atStudio = await b.go(start.headers.get('location'));
  const back = new URL(atStudio.headers.get('location') ?? '', STUDIO);
  if (back.origin !== APP) return back;
  return new URL((await b.go(back.href)).headers.get('location') ?? '', APP);
}

