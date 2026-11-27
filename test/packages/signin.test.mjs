// @hachej/boring-ui-kit/signin: sign-in by invitation, the one-use first-owner link, an assistant's OAuth sign-in to /mcp, and the Studio
// bridge (owners proven by a round trip through Studio, on Studio's signed owner list), driven through the routes a Worker serves
// (`handle`), with two instances (a Studio and an app) on in-memory node:sqlite databases. Fictional people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { APP, STUDIO, assistantToken, browser, link, me, signUp, throughStudio, world } from '../helpers/signin-world.mjs';

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

test('an assistant registers itself, signs the person in with PKCE, and its token opens /mcp as that person', async () => {
  const w = world(); const first = link(); const app = w.makeApp({ firstOwnerHash: first.hash });
  const ada = browser(w.route);
  await signUp(ada, APP, 'ada@app.test', { 'x-boring-first-owner': first.token });
  assert.equal(await app.mcpPerson(new Request(`${APP}/mcp`)), undefined);
  const refusal = app.mcpRefusal(new Request(`${APP}/mcp`));
  assert.equal(refusal.status, 401);
  assert.match(refusal.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  assert.equal((await ada.json(`${APP}/.well-known/oauth-protected-resource/mcp`)).body.resource, `${APP}/mcp`);

  const token = await assistantToken(ada, APP);
  const person = await app.mcpPerson(new Request(`${APP}/mcp`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(person?.email, 'ada@app.test');
  assert.equal(person?.role, 'owner');
});

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

test('an app\'s own owners in Studio own its deploys: Studio names them for that app only, and they come in through Studio as owners', async () => {
  const given = { demo: ['ada-master@studio.test'] };
  const w = world({ appOwners: async (app) => given[app] ?? [] });
  const olive = browser(w.route);
  assert.equal((await signUp(olive, STUDIO, 'olive@studio.test', { 'x-boring-first-owner': w.first.token })).status, 200);
  const { clientId } = (await olive.json(`${STUDIO}/api/signin/links`, { method: 'POST', body: { app: 'demo', origin: APP } })).body;
  w.makeApp({ studio: { origin: STUDIO, app: 'demo', clientId, fetch: w.studioFetch, ownersTtlMs: 0 } });

  // The app's master: a Studio member (not a Studio owner) whom Studio gives as an owner of « demo ».
  await olive.json(`${STUDIO}/api/signin/people`, { method: 'POST', body: { email: 'ada-master@studio.test', role: 'member' } });
  const ada = browser(w.route);
  await signUp(ada, STUDIO, 'ada-master@studio.test');
  assert.equal((await throughStudio(ada)).pathname, '/');
  assert.equal((await me(ada, APP)).body.person.role, 'owner', 'an owner of the app in Studio owns its deploy');

  // Studio's list for another app does not name her; a plain Studio member stays out.
  const other = (await olive.json(`${STUDIO}/api/signin/owners?app=other`)).body.token, plain = (await olive.json(`${STUDIO}/api/signin/owners`)).body.token;
  const subsOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).owners.length;
  assert.equal(subsOf(other), 1, 'only Olive, Studio\'s owner, for another app');
  assert.equal(subsOf(plain), 1, 'an app that names no app gets Studio\'s owners only');
  assert.equal(JSON.parse(Buffer.from(other.split('.')[1], 'base64url').toString()).app, 'other', 'the token names the app it is for');
  await olive.json(`${STUDIO}/api/signin/people`, { method: 'POST', body: { email: 'max@studio.test', role: 'member' } });
  const max = browser(w.route);
  await signUp(max, STUDIO, 'max@studio.test');
  assert.match((await throughStudio(max)).search, /error/);
});

test('Studio\'s list for an app never waits on a slow directory: past 2 s it is Studio\'s owners alone, and a name that is no app names none', async () => {
  const w = world({ appOwners: () => new Promise(() => {}) });
  const olive = browser(w.route);
  assert.equal((await signUp(olive, STUDIO, 'olive@studio.test', { 'x-boring-first-owner': w.first.token })).status, 200);
  const t0 = Date.now(), slow = (await olive.json(`${STUDIO}/api/signin/owners?app=demo`)).body.token;
  assert.ok(Date.now() - t0 < 4000, 'answered within the wait');
  assert.equal(JSON.parse(Buffer.from(slow.split('.')[1], 'base64url').toString()).owners.length, 1);
  const odd = (await olive.json(`${STUDIO}/api/signin/owners?app=${encodeURIComponent('x'.repeat(100))}`)).body.token;
  assert.equal(JSON.parse(Buffer.from(odd.split('.')[1], 'base64url').toString()).app, undefined, 'no app is echoed for a name that is none');
});
