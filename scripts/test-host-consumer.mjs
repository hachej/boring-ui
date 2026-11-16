// What a consumer installs: `@hachej/boring-agent/host` with Domain, effect and alchemy, and the agent package alone without them.
// Packs agent and files from the build into fresh folders; each gets a lockfile copied from the root lockfile and `npm ci`.
import assert from 'node:assert/strict';
import { withChordOverride } from './consumer-install.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');
const HOST_PEERS = ['@alchemy.run/domain', 'effect', 'alchemy'];
const agent = JSON.parse(readFileSync(join(root, 'packages/agent/package.json'), 'utf8'));
const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const required = Object.fromEntries(Object.entries(agent.peerDependencies).filter(([name]) => !agent.peerDependenciesMeta?.[name]?.optional));

function consumer(name, extra, script) {
  const directory = mkdtempSync(join(tmpdir(), `boring-host-consumer-${name}-`));
  const run = (command, args, env) => {
    const result = runCaptured(command, args, { cwd: directory, timeout: 180000, ...(env ? { env } : {}) });
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  try {
    const isolated = prepareConsumerIsolation(directory);
    mkdirSync(join(directory, 'packs'));
    const archives = ['files', 'agent'].map((pkg) => [`@hachej/boring-${pkg}`, JSON.parse(run('npm', ['pack', join(root, 'packages', pkg), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0].filename]);
    const dependencies = { ...required, ...Object.fromEntries(extra.map((n) => [n, agent.peerDependencies[n]])), ...Object.fromEntries(archives.map(([n, f]) => [n, `file:packs/${f}`])) };
    const manifest = { name: `isolated-host-consumer-${name}`, version: '1.0.0', private: true, type: 'module', dependencies };
    writeFileSync(join(directory, 'package.json'), JSON.stringify(withChordOverride(manifest)));
    const packages = {};
    const include = (dep, parent = '') => {
      let path = `${parent}/node_modules/${dep}`.replace(/^\//, '');
      while (!sourceLock.packages[path] && parent) {
        const ancestor = parent.lastIndexOf('/node_modules/');
        parent = ancestor === -1 ? '' : parent.slice(0, ancestor);
        path = `${parent}/node_modules/${dep}`.replace(/^\//, '');
      }
      if (packages[path]) return;
      const entry = sourceLock.packages[path];
      assert.ok(entry && !entry.link, `Missing registry lock entry: ${dep}`);
      packages[path] = entry;
      for (const d of Object.keys(entry.dependencies ?? {})) include(d, path);
      for (const d of Object.keys(entry.optionalDependencies ?? {})) if (sourceLock.packages[`node_modules/${d}`]) include(d, path);
      for (const d of Object.keys(entry.peerDependencies ?? {})) if (!entry.peerDependenciesMeta?.[d]?.optional) include(d, path);
    };
    for (const dep of Object.keys(dependencies).filter((d) => !d.startsWith('@hachej/'))) include(dep);
    // The two archives get their lock entries from the tarballs themselves: letting npm resolve them again would also place optional peers of Domain.
    for (const [n, f] of archives) packages[`node_modules/${n}`] = { version: agent.version, resolved: `file:packs/${f}`, integrity: 'sha512-' + createHash('sha512').update(readFileSync(join(directory, 'packs', f))).digest('base64') };
    packages[''] = { name: manifest.name, version: manifest.version, dependencies };
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }));
    run('npm', ['ci', ...npmInstallFlags(cache)]);
    for (const dep of HOST_PEERS) assert.equal(existsSync(join(directory, 'node_modules', dep)), extra.includes(dep), `${dep} installed: ${extra.includes(dep)}`);
    writeFileSync(join(directory, 'consumer.mjs'), script);
    return run(process.execPath, ['consumer.mjs'], isolated);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const withHost = consumer('host', HOST_PEERS, `import * as Layer from 'effect/Layer';
import { defineApp, checkAgents } from '@hachej/boring-agent/host';
const words = { app: { title: 'Exemple' }, views: { v: 'Vue' }, refusals: {} };
const app = { name: 'consumer', languages: { base: 'fr', words: { fr: words } }, models: [], handlers: Layer.empty, api: {}, expose: { page: ['A'] }, views: [{ id: 'v', component: './v.tsx' }] };
if (defineApp(app) !== app) throw new Error('defineApp changed the definition');
let message = '';
try { defineApp({ ...app, needs: ['mail'] }); } catch (e) { message = e.message; }
if (!message.startsWith('defineApp(consumer): needs: unknown capability mail')) throw new Error('refusal: ' + message);
if (typeof checkAgents !== 'function') throw new Error('checkAgents missing');
console.log('caught: needs mail ->', message);
`);
console.log(withHost.trim());
consumer('agents', [], `import * as agents from '@hachej/boring-agent/agents';
if (typeof agents.defineAgent !== 'function') throw new Error('defineAgent missing');
console.log('agents entry loads without Domain, effect or alchemy');
`);
console.log('PASS: host entry with Domain, effect and alchemy; the agent package alone installs none of them');
