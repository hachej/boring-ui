// Shared install machinery for isolated consumers of a registry item: pack the item's @boring dependencies, lock every other dependency
// to the exact entries of this repository's package-lock.json, and rewrite the item so the shadcn CLI installs integrity-checked archives.
// Used by scripts/test-feedback-registry-consumer.mjs and scripts/feedback-scenario.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const split = pin => { const at = pin.lastIndexOf('@'); return [pin.slice(0, at), pin.slice(at + 1)]; };

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
    const [name, version] = split(pin);
    assert.match(version, /^\d+\.\d+\.\d+$/);
    let bytes;
    if (name.startsWith('@hachej/boring-')) bytes = readFileSync(archiveByName.get(name));
    else {
      const entry = sourceLock.packages['node_modules/' + name];
      assert.equal(entry.version, version);
      const [algorithm, encoded] = entry.integrity.split('-');
      assert.equal(algorithm, 'sha512');
      const digest = Buffer.from(encoded, 'base64').toString('hex');
      bytes = readFileSync(join(cache, '_cacache/content-v2/sha512', digest.slice(0, 2), digest.slice(2, 4), digest.slice(4)));
      assert.equal(createHash('sha512').update(bytes).digest('base64'), encoded, name + ' archive integrity');
    }
    const archive = join(packs, createHash('sha256').update(bytes).digest('hex') + '.tgz');
    writeFileSync(archive, bytes);
    const archived = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']));
    assert.equal(archived.name, name); assert.equal(archived.version, version);
    return name + '@file:' + archive;
  });
  return local;
}
