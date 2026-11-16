// node scratch/sqlite-probe/run.mjs [--candidates]
// Starts the probe worker under `wrangler dev --local` (workerd, no account), runs the interleavings, prints one JSON block each, stops it by pid.
// Without --candidates: today's direct connection. With it: candidate (b), the files in a second object, as well.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('./', import.meta.url).pathname, root = new URL('../../', import.meta.url).pathname, port = 18821;
const p = spawn(join(root, 'node_modules/.bin/wrangler'), ['dev', '--local', '--config', join(here, 'wrangler.jsonc'), '--port', String(port), '--inspector-port', String(port + 100), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'probe-sqlite-'))],
  { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; p.stdout.on('data', d => (log += d)); p.stderr.on('data', d => (log += d));
const stop = () => { try { p.kill('SIGTERM'); } catch {} };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
const until = async (f, ms = 90000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 500))) { try { const v = await f(); if (v) return v; } catch {} } return null; };
if (!(await until(async () => (await (await fetch(`http://127.0.0.1:${port}/`)).json()).ok === true))) { console.log('NOT READY\n', log.slice(-2500)); stop(); process.exit(1); }

const runs = [['direct', 'request'], ['direct', 'inside'], ['direct', 'inflight']];
if (process.argv.includes('--candidates')) runs.push(['b', 'request'], ['b', 'inside'], ['b', 'inflight']);
for (const [mode, place] of runs) {
  const r = await fetch(`http://127.0.0.1:${port}/run?mode=${mode}&place=${place}`);
  console.log(`\n=== mode=${mode} place=${place} (HTTP ${r.status})`);
  const text = await r.text();
  try { console.log(JSON.stringify(JSON.parse(text), null, 1)); } catch { console.log(text.slice(0, 2000)); }
}
stop(); await new Promise(r => setTimeout(r, 800)); process.exit(0);
