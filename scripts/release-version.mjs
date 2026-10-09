import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validReleaseVersion(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(value)) return false;
  if (value.split('-')[0].split('.').some(part => !Number.isSafeInteger(Number(part)))) return false;
  return !(value.split('-').slice(1).join('-').split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0')));
}

export function setReleaseVersion(root, version) {
  if (!validReleaseVersion(version)) throw new Error('Use an exact release version, for example 1.1.0 or 1.1.0-rc.1');
  const edits = new Map();
  const read = path => {
    const value = JSON.parse(readFileSync(join(root, path), 'utf8'));
    edits.set(path, value);
    return value;
  };
  const manifest = read('package.json'), lock = read('package-lock.json');
  if (manifest.private !== true || lock.lockfileVersion !== 3) throw new Error('Expected a private workspace root and lockfile v3');
  const packages = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const path = `packages/${entry.name}`;
    return { path, manifest: read(`${path}/package.json`) };
  });
  const names = new Set(packages.map(pkg => pkg.manifest.name));
  if (!packages.length || names.size !== packages.length) throw new Error('Expected uniquely named workspace packages');
  const pins = value => {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(value[field] ?? {})) if (names.has(name)) value[field][name] = version;
    }
  };
  for (const { path, manifest: pkg } of [{ path: '', manifest }, ...packages]) {
    const record = lock.packages?.[path];
    if (!record || record.name !== pkg.name || record.version !== pkg.version) throw new Error(`Lockfile does not match ${path || 'root'}`);
    pkg.version = version; record.version = version;
    pins(pkg); pins(record);
  }
  lock.version = version;
  const registryPins = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'dependencies' && Array.isArray(child)) value[key] = child.map(spec => {
        const name = spec.slice(0, spec.lastIndexOf('@'));
        return names.has(name) ? `${name}@${version}` : spec;
      });
      else registryPins(child);
    }
  };
  registryPins(read('registry.json'));
  for (const file of readdirSync(join(root, 'public/r')).filter(name => name.endsWith('.json'))) registryPins(read(`public/r/${file}`));
  for (const [path, value] of edits) writeFileSync(join(root, path), JSON.stringify(value, null, 2) + '\n');
  return [...edits.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: npm run release:version -- <version>');
  const changed = setReleaseVersion(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
  console.log(`Set ${process.argv[2]} in ${changed.length} manifests/registry files. Private flags are unchanged; review and commit these edits before releasing.`);
}
