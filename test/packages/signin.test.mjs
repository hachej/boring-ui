// @hachej/boring-ui-kit/signin: sign-in by invitation, the one-use first-owner link, an assistant's OAuth sign-in to /mcp, and the Studio
// bridge (owners proven by a round trip through Studio, on Studio's signed owner list), driven through the routes a Worker serves
// (`handle`), with two instances (a Studio and an app) on in-memory node:sqlite databases. Fictional people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getCurrentAuthContextAsyncLocalStorage, getCurrentDBAdapterAsyncLocalStorage, getRequestStateAsyncLocalStorage } from '@better-auth/core/context';
import { signIn } from '@hachej/boring-ui-kit/signin';

const STUDIO = 'https://studio.test', APP = 'https://app.test';
const password = 'correct horse battery';
const secret = () => randomBytes(32).toString('hex');
const link = () => { const token = randomBytes(32).toString('base64url'); return { token, hash: createHash('sha256').update(token).digest('hex') }; };

/** One browser: a cookie jar per origin, each request served by the instance that owns its origin. */
function browser(route) {
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
  return { go, json: async (input, init) => { const r = await go(input, init); return { status: r.status, body: await r.json().catch(() => ({})), r }; } };
}

const signUp = (b, origin, email, extra = {}) => b.json(`${origin}/api/auth/sign-up/email`, { method: 'POST', body: { email, password, name: email.split('@')[0] }, headers: extra });
const me = async (b, origin) => (await b.json(`${origin}/api/signin/me`));

/** A Studio and, once linked, an app; requests are routed by origin, as the two Workers would serve them. */
function world() {
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
  const makeApp = (extra) => (app = signIn({ database: new DatabaseSync(':memory:'), secret: secret(), origin: APP, appName: 'Demo', ...extra }));
  return { studio, route, first, makeApp, studioFetch };
}

test('by invitation only, and the first owner proves the one-use link: a stranger is refused in their language, a used link is dead', async () => {
  const w = world(); const first = link(); w.makeApp({ firstOwnerHash: first.hash });
  const refused = await signUp(browser(w.route), APP, 'sam@stranger.test', { 'x-boring-lang': 'fr' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'NOT_INVITED');
  assert.match(refused.body.message, /n’a pas d’invitation/);
  assert.equal((await signUp(browser(w.route), APP, 'eve@stranger.test', { 'x-boring-first-owner': 'guessed' })).status, 403);

  const ada = browser(w.route);
  assert.equal((await signUp(ada, APP, 'ada@app.test', { 'x-boring-first-owner': first.token })).status, 200);
  assert.equal((await me(ada, APP)).body.person.role, 'owner');
  assert.equal((await signUp(browser(w.route), APP, 'eve@stranger.test', { 'x-boring-first-owner': first.token })).status, 403, 'the link works once');

  assert.equal((await ada.json(`${APP}/api/signin/people`, { method: 'POST', body: { email: 'Ben@App.test' } })).status, 201);
  const ben = browser(w.route);
  assert.equal((await signUp(ben, APP, 'ben@app.test')).status, 200);
  assert.equal((await me(ben, APP)).body.person.role, 'member');
  assert.equal((await ben.json(`${APP}/api/signin/people`)).status, 403);
  await ada.json(`${APP}/api/signin/people?email=ben@app.test`, { method: 'DELETE' });
  assert.equal((await me(ben, APP)).status, 401);
});

test('the sign-in page can ask whether the first-owner link is good: any number of times, one answer for a used and an unknown link, and the first sign-up is still the owner', async () => {
  const w = world(); const first = link(); w.makeApp({ firstOwnerHash: first.hash });
  const visitor = browser(w.route);
  const check = (token) => visitor.json(`${APP}/api/signin/first-owner`, { headers: token === undefined ? {} : { 'x-boring-first-owner': token } });

  for (let opened = 0; opened < 3; opened++) assert.deepEqual((await check(first.token)).body, { valid: true }, 'looking never uses the link up');
  const unknown = await check('guessed');
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { valid: false });
  assert.deepEqual((await check()).body, { valid: false }, 'no token is no link');
  assert.equal((await visitor.json(`${APP}/api/signin/first-owner`, { method: 'POST' })).status, 405);

  const ada = browser(w.route);
  assert.equal((await signUp(ada, APP, 'ada@app.test', { 'x-boring-first-owner': first.token })).status, 200);
  assert.equal((await me(ada, APP)).body.person.role, 'owner', 'the first sign-up with the link, after any number of looks, is the owner');

  const used = await check(first.token);
  assert.deepEqual([used.status, used.body], [unknown.status, unknown.body], 'a used link answers as an unknown one does');
  for (const token of [first.token, 'guessed']) {
    const eve = browser(w.route);
    const refused = await signUp(eve, APP, 'eve@stranger.test', { 'x-boring-first-owner': token });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'NOT_INVITED', 'a used or an unknown link is an uninvited sign-up');
    assert.equal((await me(eve, APP)).status, 401);
  }

  const bare = world(); bare.makeApp({});
  assert.deepEqual((await browser(bare.route).json(`${APP}/api/signin/first-owner`, { headers: { 'x-boring-first-owner': first.token } })).body, { valid: false }, 'an app with no link');
});

/** The authorization-code dance with PKCE, as an assistant does it, in a browser signed in to the server. */
async function authorize(b, server, { clientId, redirectUri, scope, resource }) {
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

test('an assistant registers itself, signs the person in with PKCE, and its token opens /mcp as that person', async () => {
  const w = world(); const first = link(); const app = w.makeApp({ firstOwnerHash: first.hash });
  const ada = browser(w.route);
  await signUp(ada, APP, 'ada@app.test', { 'x-boring-first-owner': first.token });
  assert.equal(await app.mcpPerson(new Request(`${APP}/mcp`)), undefined);
  const refusal = app.mcpRefusal(new Request(`${APP}/mcp`));
  assert.equal(refusal.status, 401);
  assert.match(refusal.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  assert.equal((await ada.json(`${APP}/.well-known/oauth-protected-resource/mcp`)).body.resource, `${APP}/mcp`);

  const redirectUri = 'http://localhost:4545/callback', scope = 'openid profile email offline_access', resource = `${APP}/mcp`;
  const reg = await ada.json(`${APP}/api/auth/oauth2/register`, { method: 'POST', body: { redirect_uris: [redirectUri], client_name: 'Claude Code' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const { code, verifier } = await authorize(ada, APP, { clientId: reg.body.client_id, redirectUri, scope, resource });
  assert.ok(code, 'the person allowed the assistant');
  const token = await ada.json(`${APP}/api/auth/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: reg.body.client_id, code_verifier: verifier, resource }) });
  assert.equal(token.status, 200, JSON.stringify(token.body));
  const person = await app.mcpPerson(new Request(`${APP}/mcp`, { headers: { authorization: `Bearer ${token.body.access_token}` } }));
  assert.equal(person?.email, 'ada@app.test');
  assert.equal(person?.role, 'owner');
});

/** The « Studio » round trip: the app sends the browser to Studio, which sends it back with a code. */
async function throughStudio(b) {
  const start = await b.go(`${APP}/api/signin/studio`);
  assert.equal(start.status, 302);
  const atStudio = await b.go(start.headers.get('location'));
  const back = new URL(atStudio.headers.get('location') ?? '', STUDIO);
  if (back.origin !== APP) return back;
  return new URL((await b.go(back.href)).headers.get('location') ?? '', APP);
}

test('the Studio bridge: a Studio owner proven through Studio owns the app; the same e-mail signed up directly never does; a removal ends it', async () => {
  const w = world();
  const olive = browser(w.route);
  assert.equal((await signUp(olive, STUDIO, 'olive@studio.test', { 'x-boring-first-owner': w.first.token })).status, 200);
  const linkIt = () => olive.json(`${STUDIO}/api/signin/links`, { method: 'POST', body: { app: 'demo', origin: APP } });
  const { clientId } = (await linkIt()).body;
  assert.ok(clientId);
  assert.equal((await linkIt()).body.clientId, clientId, 'linking twice gives the same client');
  const app = w.makeApp({ studio: { origin: STUDIO, app: 'demo', clientId, fetch: w.studioFetch, ownersTtlMs: 0 } });

  // No invitation in the app, yet its owner: Studio's id, proven by the round trip, is on Studio's signed list. The entry back to Studio shows.
  const back = await throughStudio(olive);
  assert.equal(back.pathname, '/', back.href);
  const seen = (await me(olive, APP)).body;
  assert.equal(seen.person.role, 'owner');
  assert.equal(seen.studio, `${STUDIO}/?app=demo`);

  // A person invited in the app as a member, whose address is a Studio owner's: signed up directly, a member, and no « Studio » entry.
  await olive.json(`${STUDIO}/api/signin/people`, { method: 'POST', body: { email: 'noor@studio.test', role: 'owner' } });
  await olive.json(`${APP}/api/signin/people`, { method: 'POST', body: { email: 'noor@studio.test', role: 'owner' } });
  const squatter = browser(w.route);
  assert.equal((await signUp(squatter, APP, 'noor@studio.test')).status, 200);
  const direct = (await me(squatter, APP)).body;
  assert.equal(direct.person.role, 'member', 'an owner\'s e-mail signed up directly is not an owner');
  assert.equal(direct.studio, undefined);
  // The real Noor, Studio owner, comes through Studio: Studio's e-mail is unverified, so it does not take over the direct account.
  const noor = browser(w.route);
  await signUp(noor, STUDIO, 'noor@studio.test');
  assert.match((await throughStudio(noor)).search, /error=account_not_linked/);
  assert.equal((await me(squatter, APP)).body.person.role, 'member');

  // A Studio member who is not an owner gets no account in the app through Studio.
  await olive.json(`${STUDIO}/api/signin/people`, { method: 'POST', body: { email: 'max@studio.test', role: 'member' } });
  const max = browser(w.route);
  await signUp(max, STUDIO, 'max@studio.test');
  assert.match((await throughStudio(max)).search, /error/);
  assert.equal((await me(max, APP)).status, 401);

  // A second Studio owner, then removed in Studio: owner in the app, then nobody once the app's copy of the list renews (here at once).
  await olive.json(`${STUDIO}/api/signin/people`, { method: 'POST', body: { email: 'remy@studio.test', role: 'owner' } });
  const remy = browser(w.route);
  await signUp(remy, STUDIO, 'remy@studio.test');
  assert.equal((await throughStudio(remy)).pathname, '/');
  assert.equal((await me(remy, APP)).body.person.role, 'owner');
  await olive.json(`${STUDIO}/api/signin/people?email=remy@studio.test`, { method: 'DELETE' });
  assert.equal((await me(remy, STUDIO)).status, 401, 'removed from Studio');
  assert.equal((await me(remy, APP)).status, 401, 'and no longer an owner of the app');
  assert.ok(await app.personOf(new Request(APP)) === undefined);
});
