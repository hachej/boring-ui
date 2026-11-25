// The kit's sign-in on workerd, the runtime Cloudflare runs: a Worker mounts `signIn` on a local D1 with the shipped migration applied, and a script of
// sequential AND concurrent sign-ups, sign-ins, sessions and sign-outs runs against it. Fails (exit 1, with the rate and the first errors) on any 5xx, any
// thrown request, any signed-in call that is not answered, or « request that has since ended » in the Worker's log. Kit 0.6.2 and 0.7.0 kept Better Auth's
// object across requests, and about a quarter of sign-ins failed this way on Cloudflare; node's own tests cannot see it.
//   npm run build && node scripts/test-signin-workerd.mjs [--people 24] [--waves 3]
// Local state in a temporary folder, fictional people, no account, nothing deployed. Needs `npm run build` first (the Worker imports the built kit).
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const PEOPLE = arg('people', 24), WAVES = arg('waves', 3);
const config = fileURLToPath(new URL('../test/workerd/wrangler.jsonc', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
const TIMEOUT_MS = arg('timeout', 120) * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

const token = randomBytes(24).toString('base64url'), hash = createHash('sha256').update(token).digest('hex');
const port = await freePort();
const child = spawn(wrangler, ['dev', '--local', '--config', config, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(await freePort()),
  '--persist-to', mkdtempSync(join(tmpdir(), 'signin-workerd-')), '--var', `SECRET:${randomBytes(32).toString('hex')}`, '--var', `FIRST_OWNER_HASH:${hash}`],
{ stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
let log = '';
// A hard stop: a hung Worker (a promise that can never settle hangs its request) must fail the run with the Worker's last lines, never wait for ever.
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT after ${TIMEOUT_MS / 1000} s; the Worker's last log lines:\n${log.split('\n').slice(-40).join('\n')}`);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(1);
}, TIMEOUT_MS);
child.stdout.on('data', (c) => { log += c; });
child.stderr.on('data', (c) => { log += c; });
const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  if (child.exitCode !== null) { console.error(`wrangler dev exited ${child.exitCode}\n${log}`); process.exit(2); }
  try { if ((await fetch(`${base}/`)).ok) break; } catch { /* not up yet */ }
  if (i > 240) { stop(); console.error(`wrangler dev did not answer\n${log}`); process.exit(2); }
  await pause(500);
}

let requests = 0;
const failures = [];
const note = (what, detail) => failures.push(`${what}: ${String(detail).replace(/\s+/g, ' ').slice(0, 220)}`);
let ipCounter = 0;
/** One person's HTTP calls: a cookie jar and an address of their own (the sign-in limits are per address). */
function person() {
  const ip = `203.0.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;
  const jar = new Map();
  const call = async (path, { method = 'GET', body, headers = {}, expect = [200] } = {}) => {
    requests++;
    try {
      const h = new Headers({ origin: base, 'cf-connecting-ip': ip, ...headers });
      if (jar.size) h.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
      if (body) h.set('content-type', 'application/json');
      const r = await fetch(`${base}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) jar.set(pair.slice(0, i), v); else jar.delete(pair.slice(0, i)); }
      const text = await r.text();
      if (!expect.includes(r.status)) note(`${method} ${path} -> ${r.status} (wanted ${expect})`, text);
      return { status: r.status, text };
    } catch (error) { note(`${method} ${path} threw`, error); return { status: 0, text: '' }; }
  };
  return call;
}
const password = 'correct horse battery';

console.log(`workerd up on ${base}: ${PEOPLE} people, ${WAVES} concurrent waves, then ${PEOPLE} one at a time`);
await person()('/__migrate');
const owner = person();
await owner('/api/auth/sign-up/email', { method: 'POST', body: { email: 'owner@fictional.test', password, name: 'Owner' }, headers: { 'x-boring-first-owner': token } });
await owner('/api/signin/options');
await owner('/api/signin/me');
for (let i = 0; i < PEOPLE * (WAVES + 1); i++) await owner('/api/signin/people', { method: 'POST', body: { email: `p${i}@fictional.test`, role: 'member' }, expect: [201] });

/** One person's visit in the order the real page makes its calls: the sign-in options, sign-up, the options again, sign-in, a signed-in call, sign-out. */
async function life(i) {
  const call = person(), email = `p${i}@fictional.test`;
  await call('/api/signin/options');
  await call('/api/auth/sign-up/email', { method: 'POST', body: { email, password, name: `P${i}` } });
  await call('/api/signin/me');
  await call('/api/auth/sign-out', { method: 'POST', body: {} });
  await call('/api/signin/me', { expect: [401] });
  await call('/api/signin/options');
  await call('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
  await call('/api/signin/me');
  await call('/api/auth/get-session');
  await call('/api/auth/sign-out', { method: 'POST', body: {} });
}
let next = 0;
for (let wave = 0; wave < WAVES; wave++) await Promise.all(Array.from({ length: PEOPLE }, () => life(next++)));
for (let i = 0; i < PEOPLE; i++) await life(next++);

clearTimeout(watchdog);
stop();
await pause(500);
const ended = log.split('\n').filter((l) => /request that has since ended|Worker threw exception|Cannot perform I\/O on behalf of a different request/i.test(l));
const failed = failures.length + (ended.length ? 1 : 0);
const rate = ((failures.length / requests) * 100).toFixed(1);
console.log(`${requests} requests, ${failures.length} failed (${rate}%); Worker log lines about a request that ended or a thrown exception: ${ended.length}`);
if (failures.length || ended.length) {
  for (const f of failures.slice(0, 8)) console.error(`  FAIL ${f}`);
  for (const l of ended.slice(0, 4)) console.error(`  LOG  ${l.trim().slice(0, 220)}`);
  process.exit(1);
}
console.log('ok: every sign-up, session, sign-in and sign-out answered, sequential and concurrent');
process.exit(failed ? 1 : 0);
