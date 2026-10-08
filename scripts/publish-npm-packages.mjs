import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage } from './check-npm-packages.mjs';
import { validReleaseVersion } from './release-version.mjs';
import { runCaptured } from './run-captured.mjs';

const registry = 'https://registry.npmjs.org/';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function readRelease(directory, { version, tag, commit, root = projectRoot }) {
  if (!validReleaseVersion(version) || !['latest', 'next', 'alpha', 'beta', 'rc'].includes(tag) || (version.includes('-') && tag === 'latest')) throw new Error('Invalid release version/dist-tag; prereleases cannot use latest');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('An exact reviewed commit SHA is required');
  const release = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
  if (release.schemaVersion !== 1 || release.commit !== commit || release.version !== version || !Array.isArray(release.packages)) throw new Error('Release artifact does not match the selected commit/version');
  const manifests = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8')));
  const expected = new Map(manifests.map(manifest => [manifest.name, manifest]));
  const versions = new Map(manifests.map(manifest => [manifest.name, version]));
  const names = new Set(), filenames = new Set();
  if (release.packages.length !== manifests.length || !manifests.length) throw new Error('Release artifact must contain every workspace package');
  for (const pack of release.packages) {
    if (!expected.has(pack.name) || names.has(pack.name) || pack.version !== version) throw new Error('Unexpected, duplicate or mismatched release package');
    if (!/^[a-z0-9][A-Za-z0-9._-]*\.tgz$/.test(pack.filename) || filenames.has(pack.filename)) throw new Error('Invalid or duplicate archive filename');
    names.add(pack.name); filenames.add(pack.filename);
    const archive = join(directory, pack.filename), stat = lstatSync(archive);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release archive must be a regular file');
    const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    if (integrity !== pack.integrity) throw new Error(`Archive integrity mismatch: ${pack.name}`);
    const extract = runCaptured('tar', ['-xOzf', archive, 'package/package.json']);
    const list = runCaptured('tar', ['-tzf', archive]);
    if (extract.status !== 0 || list.status !== 0 || extract.error || list.error) throw new Error('Cannot inspect release archive');
    const manifest = JSON.parse(extract.stdout);
    if (JSON.stringify(manifest) !== JSON.stringify(expected.get(pack.name))) throw new Error(`Archive manifest differs from reviewed source: ${pack.name}`);
    const errors = checkPackage(manifest, list.stdout.trim().split('\n').map(path => path.replace(/^package\//, '')), versions, { release: true });
    if (errors.length) throw new Error(`${pack.name}: ${errors.join('; ')}`);
  }
  return release;
}

export async function publishRelease(directory, options, { fetch: request = globalThis.fetch, run = runCaptured, record = () => {} } = {}) {
  const release = readRelease(directory, options);
  const results = release.packages.map(pack => ({ name: pack.name, version: pack.version, integrity: pack.integrity, status: 'pending' }));
  const snapshot = () => record({ commit: release.commit, version: release.version, tag: options.tag, packages: structuredClone(results) });
  const lookup = async (pack, selector) => {
    const response = await request(`${registry}${encodeURIComponent(pack.name)}/${encodeURIComponent(selector)}`, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Registry lookup failed for ${pack.name}: HTTP ${response.status}`);
    const value = await response.json();
    if (value.name !== pack.name || typeof value.version !== 'string' || typeof value.dist?.integrity !== 'string') throw new Error(`Invalid registry metadata: ${pack.name}`);
    return value;
  };
  const matching = (value, pack) => value?.version === pack.version && value.dist.integrity === pack.integrity;
  const args = pack => ['publish', join(directory, pack.filename), '--json', '--ignore-scripts', '--access', 'public', '--registry', registry, '--tag', options.tag];
  if (options.dryRun) {
    for (const pack of release.packages) {
      const result = run('npm', [...args(pack), '--dry-run'], { timeout: 120000 });
      if (result.status !== 0 || result.error) throw new Error(`npm publish dry run failed: ${pack.name}`);
    }
    return { commit: release.commit, version: release.version, tag: options.tag, dryRun: true };
  }
  for (let index = 0; index < release.packages.length; index++) {
    const pack = release.packages[index], existing = await lookup(pack, pack.version);
    if (!existing) continue;
    if (!matching(existing, pack)) throw new Error(`Published version has different integrity: ${pack.name}@${pack.version}`);
    if (!matching(await lookup(pack, options.tag), pack)) throw new Error(`Published version has a different dist-tag; review manually: ${pack.name}`);
    results[index].status = 'already-published';
  }
  snapshot();
  for (let index = 0; index < release.packages.length; index++) {
    if (results[index].status === 'already-published') continue;
    const pack = release.packages[index];
    results[index].status = 'unconfirmed'; snapshot();
    const result = run('npm', args(pack), { timeout: 180000 });
    if (result.status !== 0 || result.error) {
      let code = result.error?.code;
      for (const output of [result.stdout, result.stderr]) {
        try { code ??= JSON.parse(output).error?.code; } catch { /* npm can emit non-JSON progress output. */ }
      }
      results[index].diagnostic = { exitCode: result.status, signal: result.signal ?? null, errorCode: /^[A-Z][A-Z0-9_]{0,31}$/.test(code ?? '') ? code : null };
      snapshot();
      throw new Error(`Publication unconfirmed for ${pack.name} (${results[index].diagnostic.errorCode ?? `exit ${result.status}`}); rerun the publish job with these same artifacts to reconcile`);
    }
    if (!matching(await lookup(pack, pack.version), pack) || !matching(await lookup(pack, options.tag), pack)) throw new Error(`Registry has not confirmed package/version/tag for ${pack.name}; retain these artifacts`);
    results[index].status = 'published'; snapshot();
  }
  return { commit: release.commit, version: release.version, tag: options.tag, packages: results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, version, tag, mode] = process.argv.slice(2);
  if (process.argv.length !== 6 || !['--dry-run', '--publish'].includes(mode)) throw new Error('Usage: node scripts/publish-npm-packages.mjs <directory> <version> <tag> <--dry-run|--publish>');
  const result = await publishRelease(resolve(directory), { version, tag, commit: process.env.GITHUB_SHA, dryRun: mode === '--dry-run' }, {
    record: value => writeFileSync(join(directory, 'publication.json'), JSON.stringify(value, null, 2) + '\n'),
  });
  console.log(JSON.stringify(result, null, 2));
}
