// What a consumer installs: a plain `npm install` (no flag, no override) of the packed agent and files packages next to pi 1.6.0.
// One folder also installs Domain, effect and alchemy and uses `@hachej/boring-agent/host` and `/host-runtime`; the other has none of the three and uses `/agents`.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const HOST_PEERS = ['@alchemy.run/domain', 'effect', 'alchemy'];
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const agent = JSON.parse(readFileSync(join(root, 'packages/agent/package.json'), 'utf8'));
const required = Object.fromEntries(Object.entries(agent.peerDependencies).filter(([name]) => !agent.peerDependenciesMeta?.[name]?.optional));
const HOST_PEERS_VERSIONS = () => Object.fromEntries(HOST_PEERS.map((n) => [n, rootPackage.devDependencies[n]]));
const exact = (range) => range.replace(/^[~^]/, '');
const pi = Object.fromEntries(Object.entries(required).filter(([name]) => name.startsWith('@earendil-works/')).map(([name, range]) => [name, exact(range)]));

function consumer(name, extra, script) {
  const directory = mkdtempSync(join(tmpdir(), `boring-host-consumer-${name}-`));
  const run = (command, args, env) => {
    const result = runCaptured(command, args, { cwd: directory, timeout: 600000, ...(env ? { env } : {}) });
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  try {
    const isolated = prepareConsumerIsolation(directory);
    mkdirSync(join(directory, 'packs'));
    const archives = ['files', 'agent'].map((pkg) => [`@hachej/boring-${pkg}`, JSON.parse(run('npm', ['pack', join(root, 'packages', pkg), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0].filename]);
    const dependencies = { ...pi, ...Object.fromEntries(extra.map((n) => [n, rootPackage.devDependencies[n]])), ...Object.fromEntries(archives.map(([n, f]) => [n, `file:packs/${f}`])) };
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: `isolated-host-consumer-${name}`, version: '1.0.0', private: true, type: 'module', dependencies }));
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    for (const dep of HOST_PEERS) assert.equal(existsSync(join(directory, 'node_modules', dep)), extra.includes(dep), `${dep} installed: ${extra.includes(dep)}`);
    writeFileSync(join(directory, 'consumer.mjs'), script);
    return run(process.execPath, ['consumer.mjs'], isolated);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

consumer('agents', [], `import * as agents from '@hachej/boring-agent/agents';
if (typeof agents.defineAgent !== 'function') throw new Error('defineAgent missing');
console.log('agents entry loads without Domain, effect or alchemy');
let message = '';
try { await import('@hachej/boring-agent/host'); } catch (e) { message = e.message; }
const expected = ${JSON.stringify(Object.entries(HOST_PEERS_VERSIONS()).map(([n, v]) => `${n}@${v}`))};
for (const pin of expected) if (!message.includes(pin)) throw new Error('the host entry without its packages must name ' + pin + ': ' + message);
console.log('host entry without them says:', message.split(':')[0]);
`).trim().split('\n').forEach((line) => console.log(line));
const withHost = consumer('host', HOST_PEERS, `import * as Layer from 'effect/Layer';
import { defineApp, checkAgents } from '@hachej/boring-agent/host';
const words = { app: { title: 'Example' }, views: { v: 'View' }, refusals: {} };
const app = { name: 'consumer', languages: { base: 'en', words: { en: words } }, models: [], handlers: Layer.empty, api: {}, expose: { page: ['A'] }, views: [{ id: 'v', component: './v.tsx' }] };
if (defineApp(app) !== app) throw new Error('defineApp changed the definition');
let message = '';
try { defineApp({ ...app, needs: ['mail'] }); } catch (e) { message = e.message; }
if (!message.startsWith('defineApp(consumer): needs: unknown capability mail')) throw new Error('refusal: ' + message);
if (typeof checkAgents !== 'function') throw new Error('checkAgents missing');
console.log('caught: needs mail ->', message);
`);
console.log(withHost.trim());
const withRuntime = consumer('host-runtime', HOST_PEERS, `const runtime = await import('@hachej/boring-agent/host-runtime');
for (const name of ['createSession', 'appTools', 'checkExpose', 'checkAgentTools', 'modelRoute']) if (typeof runtime[name] !== 'function') throw new Error(name + ' missing');
if (typeof runtime.SenderUnknown !== 'function') throw new Error('SenderUnknown missing');
console.log('host-runtime entry loads with Domain, effect and alchemy');
`);
console.log(withRuntime.trim());
const withBuild = consumer('host-build', HOST_PEERS, `import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const host = await import('@hachej/boring-agent/host');
const build = await import('@hachej/boring-agent/host-build');
if (typeof host.defineApp !== 'function' || typeof build.hostBuild !== 'function') throw new Error('host or host-build entry incomplete');
cpSync(${JSON.stringify(join(root, 'fixtures/host-apps/todo'))}, 'todo', { recursive: true });
writeFileSync('todo/options.ts', 'export default {};');
const run = spawnSync('node_modules/.bin/boring-host-build', ['todo', '--options', './options.ts'], { encoding: 'utf8' });
if (run.status !== 0) throw new Error('boring-host-build failed: ' + run.stderr);
for (const file of ['server.ts', 'assets.ts', 'page.tsx']) if (!existsSync('todo/.gen/' + file)) throw new Error(file + ' not written');
console.log('host-build entry loads and boring-host-build writes the three files');
`);
console.log(withBuild.trim());
console.log('PASS: a plain npm install of the packed packages works with and without Domain, effect and alchemy');
