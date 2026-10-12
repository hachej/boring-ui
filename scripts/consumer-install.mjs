// Shared install machinery for isolated consumers of a registry item: pack the item's @boring dependencies, lock every other dependency
// to the exact entries of this repository's package-lock.json, and rewrite the item so the shadcn CLI installs integrity-checked archives.
// Used by scripts/test-feedback-registry-consumer.mjs and scripts/feedback-scenario.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';

const split = pin => { const at = pin.lastIndexOf('@'); return [pin.slice(0, at), pin.slice(at + 1)]; };

/** A registry dependency pin: an exact version or a caret range, with an optional prerelease (release-version writes 1.1.0-rc.1). */
export const registryPin = /^\^?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function workspaceDirectory(root, name) {
  for (const entry of readdirSync(join(root, 'packages'))) {
    const directory = join(root, 'packages', entry);
    if (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name === name) return directory;
  }
  throw new Error(`Unknown workspace package: ${name}`);
}

export function packBoringDependencies(root, item, packs, run) {
  const archiveByName = new Map();
  for (const pin of item.dependencies.filter(pin => pin.startsWith('@hachej/boring-'))) {
    const name = split(pin)[0];
    const packed = JSON.parse(run('npm', ['pack', workspaceDirectory(root, name), '--json', '--ignore-scripts', '--pack-destination', packs]))[0];
    archiveByName.set(packed.name, join(packs, packed.filename));
  }
  return archiveByName;
}

/** The item's non-@boring pins as a dependencies object, plus the named devDependencies of this repository at their pinned versions. */
export function consumerDependencies(root, item, tools) {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(item.dependencies.filter(pin => !pin.startsWith('@hachej/boring-')).map(split));
  for (const name of tools) dependencies[name] = rootManifest.devDependencies[name];
  return dependencies;
}

/** Writes package.json and a lockfile that holds exactly this repository's locked entries for `dependencies` and their closure. */
export function writeLockedManifest(root, directory, name, dependencies) {
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const manifest = { name, version: '1.0.0', private: true, type: 'module', dependencies };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  const packages = {};
  const include = (dependency, parent = '') => {
    let path = `${parent}/node_modules/${dependency}`.replace(/^\//, '');
    while (!sourceLock.packages[path] && parent) {
      const ancestor = parent.lastIndexOf('/node_modules/');
      parent = ancestor === -1 ? '' : parent.slice(0, ancestor);
      path = `${parent}/node_modules/${dependency}`.replace(/^\//, '');
    }
    if (packages[path]) return;
    const entry = sourceLock.packages[path];
    assert.ok(entry && !entry.link, `Missing registry lock entry: ${dependency}`);
    packages[path] = entry;
    for (const child of Object.keys(entry.dependencies ?? {})) include(child, path);
    for (const child of Object.keys(entry.optionalDependencies ?? {})) if (sourceLock.packages[`node_modules/${child}`]) include(child, path);
    for (const child of Object.keys(entry.peerDependencies ?? {})) if (!entry.peerDependenciesMeta?.[child]?.optional) include(child, path);
  };
  for (const dependency of Object.keys(dependencies)) include(dependency);
  packages[''] = { name: manifest.name, version: manifest.version, dependencies };
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }));
  return sourceLock;
}

/**
 * The item with every dependency pinned to a local archive: the packed @boring archive, or the npm archive from `cache` whose sha512
 * matches this repository's lock. The shadcn CLI installs dependencies by name, so this is what makes it install exactly these bytes.
 */
export function localRegistryItem(root, item, archiveByName, packs, cache, run) {
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const local = structuredClone(item);
  local.dependencies = item.dependencies.map(pin => {
    const [name, range] = split(pin);
    assert.match(range, registryPin);
    // The exact version this repository locks (or the workspace package itself); the pin's range must admit it.
    const expected = name.startsWith('@hachej/boring-') ? JSON.parse(readFileSync(join(workspaceDirectory(root, name), 'package.json'), 'utf8')).version : sourceLock.packages['node_modules/' + name]?.version;
    assert.ok(expected && semver.satisfies(expected, range), `${name}@${range}`);
    let bytes;
    if (name.startsWith('@hachej/boring-')) bytes = readFileSync(archiveByName.get(name));
    else {
      const entry = sourceLock.packages['node_modules/' + name];
      assert.equal(entry.version, expected);
      const [algorithm, encoded] = entry.integrity.split('-');
      assert.equal(algorithm, 'sha512');
      const digest = Buffer.from(encoded, 'base64').toString('hex');
      bytes = readFileSync(join(cache, '_cacache/content-v2/sha512', digest.slice(0, 2), digest.slice(2, 4), digest.slice(4)));
      assert.equal(createHash('sha512').update(bytes).digest('base64'), encoded, name + ' archive integrity');
    }
    const archive = join(packs, createHash('sha256').update(bytes).digest('hex') + '.tgz');
    writeFileSync(archive, bytes);
    const archived = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']));
    assert.equal(archived.name, name); assert.equal(archived.version, expected);
    return name + '@file:' + archive;
  });
  return local;
}

/** An item and every item it needs through registryDependencies (`@boring-ui/<name>`), read from public/r. */
export function registryClosure(root, name) {
  const closure = new Map();
  const visit = item => {
    if (closure.has(item)) return;
    const read = JSON.parse(readFileSync(join(root, 'public/r', `${item}.json`), 'utf8'));
    closure.set(item, read);
    for (const dependency of read.registryDependencies ?? []) visit(dependency.replace('@boring-ui/', ''));
  };
  visit(name);
  return closure;
}

/**
 * Serves every item of the closure over HTTP from the consumer's own registry/r directory, with each item's pins pointed at its checked
 * archive, so the CLI resolves `@boring-ui/*` dependencies the way it would from a hosted registry. Returns the base URL and the server
 * process (the caller stops it).
 */
export async function serveRegistry(root, directory, closure, archiveByName, packs, cache, run) {
  mkdirSync(join(directory, 'registry/r'), { recursive: true });
  for (const [name, item] of closure) writeFileSync(join(directory, 'registry/r', `${name}.json`), JSON.stringify(item.dependencies ? localRegistryItem(root, item, archiveByName, packs, cache, run) : item));
  const server = spawn(process.execPath, ['-e', `const { createServer } = require('node:http'); const { readFile } = require('node:fs/promises'); const { join } = require('node:path');
createServer(async (req, res) => { try { const body = await readFile(join(${JSON.stringify(join(directory, 'registry'))}, new URL(req.url, 'http://x').pathname.replace(/\\.\\./g, ''))); res.writeHead(200, { 'content-type': 'application/json' }).end(body); } catch { res.writeHead(404).end(); } })
  .listen(0, '127.0.0.1', function () { console.log('port ' + this.address().port); });`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((done, fail) => { server.stdout.on('data', chunk => { const found = /port (\d+)/.exec(String(chunk)); if (found) done(Number(found[1])); }); server.once('exit', code => fail(new Error(`registry server exited ${code}`))); });
  return { url: `http://127.0.0.1:${port}/r`, server };
}
