import { constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { INTENTIONALLY_PRIVATE, isExcludedFromRelease } from './release-set.mjs';
import { loadBoundary } from './check-pi-boundary.mjs';

export function checkPackage(manifest, paths, versions, { release = false } = {}) {
  const errors = [];
  const files = new Set(paths);
  for (const path of ['package.json', 'README.md', 'LICENSE']) {
    if (!files.has(path)) errors.push(`Missing ${path}`);
  }
  if (manifest.name === '@hachej/boring-ui-kit' && !files.has('THIRD_PARTY_NOTICES.md')) errors.push('Missing embedded icon license notices');
  const isTreeStyles = path => manifest.name === '@hachej/boring-ui-kit' && path === 'styles/file-tree.css';
  for (const path of files) {
    if (isTreeStyles(path)) continue;
    if (!/^(package\.json|README\.md|LICENSE|INVARIANTS\.md|THIRD_PARTY_NOTICES\.md|dist\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|d\.ts))$/.test(path)) errors.push(`Unexpected packed file: ${path}`);
  }
  function target(value) {
    if (typeof value === 'string') {
      if (!value.startsWith('./') || (!value.startsWith('./dist/') && !isTreeStyles(value.slice(2))) || value.split('/').includes('..') || !files.has(value.slice(2))) errors.push(`Missing or invalid export target: ${value}`);
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
    if (INTENTIONALLY_PRIVATE.has(manifest.name) && manifest.private !== true) errors.push('Intentionally private package must stay private');
    else if (manifest.private !== false) errors.push('Publication remains disabled: private must explicitly be false');
    if (!manifest.version || /^0\.0\.0(?:$|[-+])/.test(manifest.version)) errors.push('Choose a release version before publication');
  }
  return errors;
}

export function checkPackages(root, { release = false, outputDirectory, commit } = {}) {
  if (outputDirectory && (!release || !/^[a-f0-9]{40}$/.test(commit ?? ''))) throw new Error('Retained release archives require --release and an exact commit SHA');
  const packages = readdirSync(join(root, 'packages')).map(name => {
    const directory = join(root, 'packages', name);
    return { directory, manifest: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) };
  });
  const versions = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]));
  const directory = mkdtempSync(join(tmpdir(), 'boring-npm-pack-'));
  const errors = [];
  const packs = [], skipped = [];
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (release && (rootManifest.private !== true || packages.some(pkg => pkg.manifest.version !== rootManifest.version))) errors.push('Release requires a private root and one synchronized package version');
  if (versions.size !== packages.length) errors.push('Duplicate package names');
  function run(command, args) {
    const result = runCaptured(command, args, { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0 || result.error || result.signal) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.signal}`);
    return result.stdout;
  }
  try {
    for (const pkg of packages) {
      if (release && isExcludedFromRelease(pkg.manifest)) { skipped.push(pkg.manifest.name); continue; }
      const [pack] = JSON.parse(run('npm', ['pack', pkg.directory, '--ignore-scripts', '--json', '--pack-destination', directory]));
      const archive = join(directory, pack.filename);
      const paths = run('tar', ['-tzf', archive]).trim().split('\n').map(path => path.replace(/^package\//, ''));
      const manifest = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']));
      if (JSON.stringify(manifest) !== JSON.stringify(pkg.manifest)) errors.push(`${pkg.manifest.name}: packed manifest differs from source`);
      errors.push(...checkPackage(manifest, paths, versions, { release }).map(error => `${manifest.name}: ${error}`));
      if (paths.includes('LICENSE') && run('tar', ['-xOzf', archive, 'package/LICENSE']) !== readFileSync(join(root, 'LICENSE'), 'utf8')) errors.push(`${manifest.name}: packed license differs from repository license`);
      const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
      if (integrity !== pack.integrity) errors.push(`${manifest.name}: archive integrity differs from npm pack`);
      packs.push({ name: pack.name, version: pack.version, filename: pack.filename, integrity, size: pack.size, files: paths.length });
    }
    if (outputDirectory && !errors.length) {
      mkdirSync(outputDirectory);
      for (const pack of packs) copyFileSync(join(directory, pack.filename), join(outputDirectory, pack.filename), constants.COPYFILE_EXCL);
      // Deferred runtime proofs are backlog, not blockers (owner ruling 2026-10-10); record them with the artifact.
      let deferredProofs = [];
      try { deferredProofs = loadBoundary(root).pending.map(({ id, command, reason }) => ({ id, command, reason })); } catch { /* fixtures without VERIFY.json */ }
      writeFileSync(join(outputDirectory, 'release.json'), JSON.stringify({ schemaVersion: 1, commit, version: rootManifest.version, packages: packs, skippedPrivate: skipped, deferredProofs }, null, 2) + '\n', { flag: 'wx' });
    }
    return { errors, packs, skipped };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--out');
  if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) throw new Error('--out requires a new artifact directory');
  const result = checkPackages(fileURLToPath(new URL('../', import.meta.url)), { release: args.includes('--release'), outputDirectory: outputIndex < 0 ? undefined : args[outputIndex + 1], commit: process.env.GITHUB_SHA });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length ? 1 : 0;
}
