// @hachej/boring-ui-kit/signin, Studio's pass on /mcp: an app linked to Studio takes Studio's 5-minute pass (an EdDSA JWT checked against
// Studio's /.well-known/jwks.json) besides its own OAuth tokens, and refuses every other pass. Studio is a stand-in here (its JWKS answered by this
// test, passes signed with a key made for the run) next to a real Studio for the owner list; no request leaves the process. Fictional people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign as edSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { gate } from '../fixtures/studio-template-signin.ts';
import { APP, STUDIO, assistantToken, browser, link, me, secret, signUp, throughStudio, world } from '../helpers/signin-world.mjs';

const NAME = 'demo';
const TABLES = ['user', 'account', 'session', 'verification', 'invitation', 'jwks'];
const counts = (db) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`select count(*) as n from "${t}"`).get().n]));
const seconds = () => Math.floor(Date.now() / 1000);
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** Studio's keys and its /.well-known/jwks.json: `mode` is how it answers, `hits` how often it was asked. */
async function standIn() {
  const keys = new Map(), state = { mode: 'ok', hits: 0 };
  const add = async (kid) => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    keys.set(kid, { privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA', use: 'sig' } });
  };
  await add('k1');
  const serve = () => {
    state.hits++;
    if (state.mode === 'down') throw new TypeError('fetch failed');
    if (state.mode === '500') return new Response('boom', { status: 500 });
    return Response.json({ keys: state.mode === 'empty' ? [] : [...keys.values()].map((k) => k.jwk) });
  };
  /** A pass as Studio's appToken makes it, then bent by `claims` (undefined drops a claim) and `how`. */
  const pass = async (claims = {}, { kid = 'k1', alg = 'EdDSA', key } = {}) => {
    const iat = claims.iat ?? seconds();
    const body = Object.fromEntries(Object.entries({ iss: STUDIO, aud: NAME, sub: 'studio-ben', email: 'ben@app.test', name: 'Ben', iat, exp: iat + 300, jti: randomUUID(), ...claims }).filter(([, v]) => v !== undefined));
    return new SignJWT(body).setProtectedHeader({ alg, typ: 'JWT', kid }).sign(key ?? keys.get(kid).privateKey);
  };
  return { keys, state, add, serve, pass, hits: () => state.hits };
}

/** An app linked to Studio (a real Studio for the owner list and the round trip, the stand-in for the keys), its owner Olive through Studio,
 *  and Ben, invited as a member and signed up directly. `fresh()` is another instance of the same app: same database, empty caches. */
async function linked() {
  const w = world();
  const olive = browser(w.route);
  assert.equal((await signUp(olive, STUDIO, 'olive@studio.test', { 'x-boring-first-owner': w.first.token })).status, 200);
  const { clientId } = (await olive.json(`${STUDIO}/api/signin/links`, { method: 'POST', body: { app: NAME, origin: APP } })).body;
  const studio = await standIn();
  const database = new DatabaseSync(':memory:'), appSecret = secret();
  const fetch = async (input, init) => (new URL(String(input instanceof Request ? input.url : input)).pathname === '/.well-known/jwks.json' ? studio.serve() : w.studioFetch(input, init));
  const fresh = () => w.makeApp({ database, secret: appSecret, studio: { origin: STUDIO, app: NAME, clientId, fetch, ownersTtlMs: 0 } });
  const app = fresh();
  await throughStudio(olive);
  const invite = async (email, role) => assert.equal((await olive.json(`${APP}/api/signin/people`, { method: 'POST', body: { email, role } })).status, 201);
  const member = async (email) => { await invite(email); const b = browser(w.route); assert.equal((await signUp(b, APP, email)).status, 200); return b; };
  const ben = await member('ben@app.test');
  const oliveSub = (await me(olive, STUDIO)).body.person.id;
  return { w, olive, oliveSub, ben, studio, database, app, fresh, invite, member };
}

/** The Worker's /mcp: who `mcpPerson` says, else `mcpRefusal`; `owner_only` is an operation for owners. */
function mcp(app) {
  const calls = [];
  const handle = async (request) => {
    const person = await app.mcpPerson(request);
    if (!person) return app.mcpRefusal(request);
    const { params } = await request.json();
    calls.push({ email: person.email, role: person.role, name: params.name });
    if (params.name === 'owner_only' && person.role !== 'owner') return new Response('owners only', { status: 403 });
    return Response.json({ as: person.email, role: person.role });
  };
  const call = (token, name = 'any') => handle(new Request(`${APP}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }),
  }));
  return { calls, call };
}

async function accepted(worker, token, as, name) {
  const r = await worker.call(token, name);
  assert.equal(r.status, 200, `${as.email} through ${name ?? 'any'}`);
  assert.deepEqual(await r.json(), { as: as.email, role: as.role });
}

async function refused(ctx, worker, token, why) {
  const before = counts(ctx.database), ran = worker.calls.length;
  const r = await worker.call(token);
  assert.equal(r.status, 401, why);
  assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer resource_metadata=".*oauth-protected-resource\/mcp"$/, why);
  assert.equal(worker.calls.length, ran, `${why}: no operation ran`);
  assert.deepEqual(counts(ctx.database), before, `${why}: no row written`);
}

const BEN = { email: 'ben@app.test', role: 'member' }, OLIVE = { email: 'olive@studio.test', role: 'owner' };

test('Studio\'s pass opens /mcp as the app\'s person: by e-mail for a member, by Studio id first for an owner; the app\'s own token still works', async () => {
  const ctx = await linked(), worker = mcp(ctx.app);
  const { pass } = ctx.studio;
  const own = await assistantToken(ctx.ben, APP);
  await accepted(worker, own, BEN);
  await accepted(worker, await pass(), BEN);
  await accepted(worker, await pass({ email: 'Ben@App.Test' }), BEN);
  await accepted(worker, await pass({ sub: ctx.oliveSub, email: 'olive@studio.test' }), OLIVE);
  await accepted(worker, await pass({ sub: ctx.oliveSub, email: 'olive.new@studio.test' }), OLIVE);
  await accepted(worker, await pass({ role: 'owner', name: undefined }), BEN);
  assert.equal(ctx.studio.hits(), 1, 'Studio\'s keys are fetched once and kept');
});

test('every other pass is refused with the sign-in 401, runs no operation and writes no row', async () => {
  const ctx = await linked(), worker = mcp(ctx.app);
  const { pass, keys } = ctx.studio;
  await accepted(worker, await assistantToken(ctx.ben, APP), BEN);
  await ctx.invite('zoe@app.test');
  await ctx.invite('noor@studio.test', 'owner');
  const rogue = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: STUDIO, aud: NAME, sub: 'studio-ben', email: 'ben@app.test', iat: seconds(), exp: seconds() + 300 })}.`;
  const hmac = await pass({}, { alg: 'HS256', key: new TextEncoder().encode(keys.get('k1').jwk.x) });
  const cases = {
    'expired': await pass({ iat: seconds() - 400, exp: seconds() - 100 }),
    'the other stage\'s aud': await pass({ aud: `${NAME}draft` }),
    'another app\'s aud': await pass({ aud: 'idealab' }),
    'an aud list holding the app': await pass({ aud: [NAME, 'idealab'] }),
    'a key not in Studio\'s keys, under a known kid': await pass({}, { key: rogue.privateKey }),
    'a key not in Studio\'s keys, under its own kid': await pass({}, { kid: 'rogue', key: rogue.privateKey }),
    'the issuer with /api/auth': await pass({ iss: `${STUDIO}/api/auth` }),
    'another issuer': await pass({ iss: 'https://other.test' }),
    'an e-mail with no account or invitation': await pass({ email: 'nobody@studio.test' }),
    'an invited e-mail with no account': await pass({ email: 'zoe@app.test', sub: 'studio-zoe' }),
    'an owner\'s e-mail invited as a member, no account': await pass({ email: 'noor@studio.test', sub: 'studio-noor' }),
    'a sub other than the Studio account of the e-mail\'s user': await pass({ sub: 'someone-else', email: 'olive@studio.test' }),
    'alg none': none,
    'HS256 with Studio\'s public key as the secret': hmac,
    'a pass longer than 300 s': await pass({ exp: seconds() + 301 }),
    'no email': await pass({ email: undefined }),
    'no sub': await pass({ sub: undefined }),
    'no exp': await pass({ exp: undefined }),
    'a bearer that is no token': 'not-a-token',
  };
  await refused(ctx, worker, undefined, 'no token');
  for (const [why, token] of Object.entries(cases)) await refused(ctx, worker, token, why);
  assert.equal((await ctx.app.mcpPerson(new Request(`${APP}/mcp`, { headers: { authorization: `Bearer ${cases['an invited e-mail with no account']}` } }))), undefined);
  assert.equal(ctx.database.prepare('select count(*) as n from "user" where email = ?').get('zoe@app.test').n, 0, 'no person was made for an invited address');
  await accepted(worker, await pass(), BEN);
});

test('Studio\'s keys cannot be had: a failing, an empty or an unreachable answer refuses every pass, never a 500; an app with no Studio link refuses it too', async () => {
  const ctx = await linked();
  for (const mode of ['down', '500', 'empty']) {
    ctx.studio.state.mode = mode;
    const worker = mcp(ctx.fresh());
    await refused(ctx, worker, await ctx.studio.pass(), `Studio's keys: ${mode}`);
    ctx.studio.state.mode = 'ok';
    assert.equal((await worker.call(await ctx.studio.pass())).status, 401, `${mode}: asked again within 30 s, the answer is the same`);
  }
  await accepted(mcp(ctx.fresh()), await ctx.studio.pass(), BEN);

  const bare = world(), first = link(), database = new DatabaseSync(':memory:'), alone = bare.makeApp({ firstOwnerHash: first.hash, database }), ada = browser(bare.route);
  assert.equal((await signUp(ada, APP, 'ada@app.test', { 'x-boring-first-owner': first.token })).status, 200);
  await accepted(mcp(alone), await assistantToken(ada, APP), { email: 'ada@app.test', role: 'owner' });
  await refused({ database }, mcp(alone), await ctx.studio.pass({ email: 'ada@app.test' }), 'an app with no Studio link');
});

test('Studio\'s keys are kept 5 minutes, fetched again on an unknown kid at most every 30 s, and a burst of unknown kids makes one fetch', async (t) => {
  const ctx = await linked(), { studio } = ctx;
  t.mock.timers.enable({ apis: ['Date'] });
  const worker = mcp(ctx.fresh()), rogue = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const burst = await Promise.all(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((kid) => studio.pass({}, { kid, key: rogue.privateKey }).then((token) => worker.call(token))));
  assert.deepEqual(burst.map((r) => r.status), Array(6).fill(401));
  assert.equal(studio.hits(), 1, 'six unknown kids, one fetch');
  await accepted(worker, await studio.pass(), BEN);
  assert.equal(studio.hits(), 1, 'a known kid is served from the kept keys');

  await studio.add('k2');
  assert.equal((await worker.call(await studio.pass({}, { kid: 'k2' }))).status, 401, 'a new kid within 30 s of the last fetch is not fetched for');
  assert.equal(studio.hits(), 1);
  t.mock.timers.tick(31_000);
  await accepted(worker, await studio.pass({}, { kid: 'k2' }), BEN);
  assert.equal(studio.hits(), 2, 'after 30 s the unknown kid is looked for, and found');
  t.mock.timers.tick(4 * 60_000);
  await accepted(worker, await studio.pass(), BEN);
  assert.equal(studio.hits(), 2, 'kept 5 minutes');
  t.mock.timers.tick(61_000);
  await accepted(worker, await studio.pass(), BEN);
  assert.equal(studio.hits(), 3, 'fetched again past 5 minutes');
});

test('a pass gives the role the app works out at this request, never more: a member\'s pass is refused where the member\'s token is, an owner through Studio is an owner, an owner who never made the round trip is a member', async () => {
  const ctx = await linked(), worker = mcp(ctx.app);
  const { pass } = ctx.studio;
  const memberToken = await assistantToken(ctx.ben, APP), ownerToken = await assistantToken(ctx.olive, APP);
  for (const token of [memberToken, await pass(), await pass({ role: 'owner', roles: ['owner'], admin: true })]) assert.equal((await worker.call(token, 'owner_only')).status, 403);
  for (const token of [ownerToken, await pass({ sub: ctx.oliveSub, email: 'olive@studio.test' })]) await accepted(worker, token, OLIVE, 'owner_only');

  const noorStudio = browser(ctx.w.route);
  await ctx.olive.json(`${STUDIO}/api/signin/people`, { method: 'POST', body: { email: 'noor@studio.test', role: 'owner' } });
  assert.equal((await signUp(noorStudio, STUDIO, 'noor@studio.test')).status, 200);
  const noorSub = (await me(noorStudio, STUDIO)).body.person.id;
  await ctx.member('noor@studio.test');
  const asNoor = await worker.call(await pass({ sub: noorSub, email: 'noor@studio.test' }), 'owner_only');
  assert.equal(asNoor.status, 403, 'a Studio owner who never made the round trip has a member\'s rights');
  await accepted(worker, await pass({ sub: noorSub, email: 'noor@studio.test' }), { email: 'noor@studio.test', role: 'member' });

  await ctx.member('cleo@app.test');
  const cleo = await pass({ sub: 'studio-cleo', email: 'cleo@app.test' });
  await accepted(worker, cleo, { email: 'cleo@app.test', role: 'member' });
  await ctx.olive.json(`${APP}/api/signin/people?email=cleo@app.test`, { method: 'DELETE' });
  await refused(ctx, worker, cleo, 'a person removed from the invitation list, at their next pass');
});

test('the pass is for /mcp only, and is never stored nor logged: personOf answers nobody, no table gains a row, and the output holds no trace of it', async () => {
  const ctx = await linked(), worker = mcp(ctx.app);
  await accepted(worker, await assistantToken(ctx.ben, APP), BEN);
  const before = counts(ctx.database);
  const seen = [], restore = [];
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) { const was = console[name]; console[name] = (...args) => { seen.push(args.map(String).join(' ')); }; restore.push(() => { console[name] = was; }); }
  for (const stream of [process.stdout, process.stderr]) { const was = stream.write; stream.write = function (chunk, ...rest) { seen.push(String(chunk)); return was.call(this, chunk, ...rest); }; restore.push(() => { stream.write = was; }); }
  const passes = [await ctx.studio.pass(), await ctx.studio.pass({ aud: 'other' }), await ctx.studio.pass({ iat: seconds() - 600, exp: seconds() - 300 }), await ctx.studio.pass({ sub: ctx.oliveSub, email: 'olive@studio.test' })];
  try {
    for (const token of passes) {
      assert.equal(await ctx.app.personOf(new Request(`${APP}/api/signin/me`, { headers: { authorization: `Bearer ${token}` } })), undefined, 'personOf never takes a pass');
      assert.equal((await ctx.ben.json(`${APP}/api/signin/me`, { headers: { authorization: `Bearer ${token}` } })).status, 200, 'the cookie still answers');
      await worker.call(token);
    }
  } finally { for (const undo of restore) undo(); }
  assert.deepEqual(counts(ctx.database), before);
  const stored = TABLES.map((t) => JSON.stringify(ctx.database.prepare(`select * from "${t}"`).all())).join('\n');
  for (const token of passes) for (const part of [token, token.split('.')[2]]) { assert.ok(!seen.join('\n').includes(part), 'not in the output'); assert.ok(!stored.includes(part), 'not in the tables'); }
});

test('adoption: the template\'s own worker/signin.ts, copied unchanged, takes the pass on /mcp and refuses none or another app\'s', async (t) => {
  // The template at boring-studio a130079 (templates/app/worker/signin.ts), byte for byte: an edit to this fixture to make a test pass changes the sum.
  const fixture = createHash('sha256').update(readFileSync(new URL('../fixtures/studio-template-signin.ts', import.meta.url))).digest('hex');
  assert.equal(fixture, '5954798e9ba1eaf9433f5c699e05162104ffae574e4686302e646723d79b336d');

  const { privateKey, publicKey } = generateKeyPairSync('ed25519'), kid = 'studio-1';
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' }] };
  const appToken = (aud, person) => {
    const iat = seconds(), head = b64({ alg: 'EdDSA', typ: 'JWT', kid });
    const body = b64({ iss: STUDIO, aud, sub: person.sub, email: person.email, name: person.name, iat, exp: iat + 300, jti: randomUUID() });
    return `${head}.${body}.${edSign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input instanceof Request ? input.url : input) === `${STUDIO}/.well-known/jwks.json` ? Response.json(jwks) : realFetch(input, init));
  t.after(() => { globalThis.fetch = realFetch; });

  const first = link(), ran = [];
  const env = { DB: new DatabaseSync(':memory:'), BETTER_AUTH_SECRET: secret(), FIRST_OWNER_HASH: first.hash, STUDIO_ORIGIN: STUDIO, STUDIO_APP: NAME, STUDIO_CLIENT: 'client-1' };
  const worker = (request) => gate(request, env, async () => { ran.push(new URL(request.url).pathname); return Response.json({ result: 'the stand-in operation' }); });
  const ada = browser(worker);
  assert.equal((await signUp(ada, APP, 'ada@app.test', { 'x-boring-first-owner': first.token })).status, 200);
  const call = (token) => worker(new Request(`${APP}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'any' } }),
  }));
  const adaPass = { sub: 'studio-ada', email: 'ada@app.test', name: 'Ada' };

  const ok = await call(appToken(NAME, adaPass));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { result: 'the stand-in operation' });
  assert.deepEqual(ran, ['/mcp']);
  for (const [why, token] of [['no pass', undefined], ['the other stage\'s pass', appToken(`${NAME}draft`, adaPass)], ['a stranger\'s pass', appToken(NAME, { sub: 'studio-eve', email: 'eve@stranger.test', name: 'Eve' })]]) {
    const r = await call(token);
    assert.equal(r.status, 401, why);
    assert.match(r.headers.get('www-authenticate') ?? '', /resource_metadata=/);
  }
  const page = await worker(new Request(`${APP}/api/anything`, { headers: { authorization: `Bearer ${appToken(NAME, adaPass)}` } }));
  assert.equal(page.status, 401, 'the pass opens nothing but /mcp');
  assert.deepEqual(ran, ['/mcp'], 'the stand-in operation ran once, for the member\'s pass');
});
