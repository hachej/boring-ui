import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';

export function checkPackage(manifest, paths, versions, { release = false } = {}) {
  const errors = [];
  const files = new Set(paths);
  for (const path of ['package.json', 'README.md', 'LICENSE']) {
    if (!files.has(path)) errors.push(`Missing ${path}`);
  }
  if (manifest.name === '@hachej/boring-ui-kit' && !files.has('THIRD_PARTY_NOTICES.md')) errors.push('Missing embedded icon license notices');
  for (const path of files) {
    if (!/^(package\.json|README\.md|LICENSE|INVARIANTS\.md|THIRD_PARTY_NOTICES\.md|dist\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|d\.ts))$/.test(path)) errors.push(`Unexpected packed file: ${path}`);
  }
  function target(value) {
    if (typeof value === 'string') {
      if (!value.startsWith('./dist/') || value.split('/').includes('..') || !files.has(value.slice(2))) errors.push(`Missing or invalid export target: ${value}`);
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) target(child);
    } else errors.push('Invalid export target');
  }
  if (!manifest.exports || !Object.keys(manifest.exports).length) errors.push('Missing exports');
  else target(manifest.exports);
  if (manifest.types) target(manifest.types);
  if (manifest.license !== 'MIT') errors.push('Expected repository MIT license');
  if (!manifest.repository?.directory || manifest.repository?.url !== 'git+https://github.com/hachej/boring-ui.git') errors.push('Missing repository metadata');
  if (!manifest.engines?.node) errors.push('Missing Node engine');
  if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') errors.push('Missing explicit public npm destination');
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (/^(file:|link:|workspace:|\.{1,2}[\\/]|[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(version) || (!version.includes('://') && /\.t(?:ar\.)?gz$/.test(version))) errors.push(`Local dependency: ${name}`);
      if (versions.has(name) && version !== versions.get(name)) errors.push(`Internal version mismatch: ${name}@${version}`);
    }
  }
  if (release) {
    if (manifest.private !== false) errors.push('Publication remains disabled: private must explicitly be false');
    if (!manifest.version || /^0\.0\.0(?:$|[-+])/.test(manifest.version)) errors.push('Choose a release version before publication');
  }
  return errors;
}

export function checkPackages(root, { release = false } = {}) {
  const packages = readdirSync(join(root, 'packages')).map(name => {
    const directory = join(root, 'packages', name);
    return { directory, manifest: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) };
  });
  const versions = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]));
  const directory = mkdtempSync(join(tmpdir(), 'boring-npm-pack-'));
  const errors = [];
  const packs = [];
  function run(command, args) {
    const result = runCaptured(command, args, { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0 || result.error || result.signal) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.signal}`);
    return result.stdout;
  }
  try {
    for (const pkg of packages) {
      const [pack] = JSON.parse(run('npm', ['pack', pkg.directory, '--ignore-scripts', '--json', '--pack-destination', directory]));
      const archive = join(directory, pack.filename);
      const paths = run('tar', ['-tzf', archive]).trim().split('\n').map(path => path.replace(/^package\//, ''));
      const manifest = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']));
      if (JSON.stringify(manifest) !== JSON.stringify(pkg.manifest)) errors.push(`${pkg.manifest.name}: packed manifest differs from source`);
      errors.push(...checkPackage(manifest, paths, versions, { release }).map(error => `${manifest.name}: ${error}`));
      if (paths.includes('LICENSE') && run('tar', ['-xOzf', archive, 'package/LICENSE']) !== readFileSync(join(root, 'LICENSE'), 'utf8')) errors.push(`${manifest.name}: packed license differs from repository license`);
      packs.push({ name: pack.name, version: pack.version, integrity: pack.integrity, size: pack.size, files: paths.length });
    }
    return { errors, packs };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkPackages(fileURLToPath(new URL('../', import.meta.url)), { release: process.argv.includes('--release') });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length ? 1 : 0;
}
