// @hachej/boring-ui-kit/signin with Google: « Continue with Google » shows when the app has its client, and a Google account gets in only
// when its address is invited and Google says it is verified. Google is a stand-in here (its token endpoint and keys answered by this
// test, an ID token signed with a key made for the run); no request leaves the process. Fictional people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { signIn } from '@hachej/boring-ui-kit/signin';

const APP = 'https://app.test', CLIENT = 'fictional-client.apps.googleusercontent.com';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
let profile = {};
const realFetch = globalThis.fetch;
// The stand-in Google: the code exchange answers an ID token for `profile`, the keys answer the run's public key.
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    const idToken = await new SignJWT({ ...profile, aud: CLIENT, iss: 'https://accounts.google.com' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(profile.sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    return Response.json({ access_token: 'fictional-access', id_token: idToken, token_type: 'Bearer', expires_in: 300 });
  }
  if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return Response.json({ keys: [jwk] });
  return realFetch(input, init);
};
test.after(() => { globalThis.fetch = realFetch; });

function app(google) {
  const owner = signIn({ database: new DatabaseSync(':memory:'), secret: randomBytes(32).toString('hex'), origin: APP, appName: 'Demo', ...(google ? { google } : {}) });
  return owner;
}

/** A browser on the app: one cookie jar. */
function browser(auth) {
  const jar = new Map();
  const go = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', APP); headers.set('cf-connecting-ip', '203.0.113.40');
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (init.body) headers.set('content-type', 'application/json');
    const r = await auth.handle(new Request(`${APP}${path}`, { ...init, headers, redirect: 'manual' }));
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) jar.set(pair.slice(0, i), v); else jar.delete(pair.slice(0, i)); }
    return r;
  };
  return { go };
}

/** « Continue with Google », Google's own page skipped: the browser comes back with a code and the state it was given. */
async function throughGoogle(auth, who) {
  profile = who;
  const b = browser(auth);
  const start = await b.go('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/sign-in' }) });
  const to = new URL((await start.json()).url);
  assert.equal(to.origin, 'https://accounts.google.com');
  assert.equal(to.searchParams.get('redirect_uri'), `${APP}/api/auth/callback/google`);
  const back = await b.go(`/api/auth/callback/google?code=fictional-code&state=${encodeURIComponent(to.searchParams.get('state'))}`);
  const me = await b.go('/api/signin/me');
  return { landed: new URL(back.headers.get('location') ?? '', APP), me: me.status === 200 ? (await me.json()).person : null };
}

test('« Continue with Google » is offered only when the app has its Google client', async () => {
  assert.equal((await (await app().handle(new Request(`${APP}/api/signin/options`))).json()).google, false);
  assert.equal((await (await app({ clientId: CLIENT, clientSecret: 'fictional-secret' }).handle(new Request(`${APP}/api/signin/options`))).json()).google, true);
});

test('a Google account gets in only when its address is invited and Google says it is verified', async () => {
  const auth = app({ clientId: CLIENT, clientSecret: 'fictional-secret' });
  await auth.handle(new Request(`${APP}/api/auth/ok`)); // the first request migrates the tables
  const db = await auth.auth.$context;
  await db.adapter.create({ model: 'invitation', data: { email: 'gil@fictional.test', role: 'member', invitedBy: 'test', createdAt: new Date() } });
  await db.adapter.create({ model: 'invitation', data: { email: 'ugo@fictional.test', role: 'member', invitedBy: 'test', createdAt: new Date() } });

  const stranger = await throughGoogle(auth, { sub: 'g-1', email: 'sam@fictional.test', email_verified: true, name: 'Sam' });
  assert.match(stranger.landed.search, /error/, 'an address with no invitation');
  assert.equal(stranger.me, null);

  const unverified = await throughGoogle(auth, { sub: 'g-2', email: 'ugo@fictional.test', email_verified: false, name: 'Ugo' });
  assert.match(unverified.landed.search, /error/, 'an invited address Google does not vouch for');
  assert.equal(unverified.me, null);

  const gil = await throughGoogle(auth, { sub: 'g-3', email: 'gil@fictional.test', email_verified: true, name: 'Gil' });
  assert.equal(gil.landed.pathname, '/');
  assert.equal(gil.me?.email, 'gil@fictional.test');
  assert.equal(gil.me?.role, 'member');
});
