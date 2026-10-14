import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkPackages } from '../../scripts/check-npm-packages.mjs';
import { setReleaseVersion, validReleaseVersion } from '../../scripts/release-version.mjs';
import { publishRelease, readRelease } from '../../scripts/publish-npm-packages.mjs';
import { INTENTIONALLY_PRIVATE, isExcludedFromRelease } from '../../scripts/release-set.mjs';

const commit = 'a'.repeat(40);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'boring-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, data) => { const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n'); };
  const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const main = { name: 'fixture', version: '1.0.0', private: true, workspaces: ['packages/*'] };
  write('package.json', main); write('LICENSE', 'MIT fixture license\n');
  const lock = { name: main.name, version: main.version, lockfileVersion: 3, packages: { '': main } };
  for (const name of ['files', 'agent', 'browser']) {
    const manifest = {
      name: `@hachej/boring-${name}`, version: main.version, private: name === 'browser', license: 'MIT', type: 'module',
      repository: { url: 'git+https://github.com/hachej/boring-ui.git', directory: `packages/${name}` },
      engines: { node: '>=22.19.0' }, publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
      files: ['dist', 'README.md', 'LICENSE'], exports: { '.': './dist/index.js' },
      ...(name === 'agent' ? { peerDependencies: { '@hachej/boring-files': '^1.0.0', external: '1.0.0' } } : {}),
    };
    write(`packages/${name}/package.json`, manifest);
    write(`packages/${name}/LICENSE`, 'MIT fixture license\n'); write(`packages/${name}/README.md`, '# Fixture\n'); write(`packages/${name}/dist/index.js`, 'export const value = 42;\n');
    lock.packages[`packages/${name}`] = structuredClone(manifest);
  }
  write('package-lock.json', lock);
  const registry = { items: [{ name: 'fixture', dependencies: ['@hachej/boring-files@^1.0.0', 'external@1.0.0'] }] };
  write('registry.json', registry);
  write('public/r/fixture.json', { ...registry.items[0], registryDependencies: ['https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@1.0.0/r/utils.json', 'https://example.test/r/other.json'] });
  return { root, read, write, directory: join(root, 'archives'), options: { root, version: '1.0.0', tag: 'next', commit } };
}

test('the publish set is every workspace package except the owner-private ones', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const manifests = readdirSync(join(root, 'packages')).map(dir => JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')));
  const published = manifests.filter(manifest => !isExcludedFromRelease(manifest)).map(manifest => manifest.name).sort();
  assert.deepEqual(published, ['@hachej/boring-agent', '@hachej/boring-execution', '@hachej/boring-feedback', '@hachej/boring-files', '@hachej/boring-ui-kit']);
  assert.deepEqual([...INTENTIONALLY_PRIVATE].sort(), ['@hachej/boring-browser', '@hachej/boring-testing']);
  for (const manifest of manifests) if (INTENTIONALLY_PRIVATE.has(manifest.name)) assert.equal(manifest.private, true, manifest.name);
  for (const name of published) assert.notEqual(manifests.find(manifest => manifest.name === name).private, true, name);
});

test('release version edits synchronize internal pins without changing privacy or external versions', t => {
  const f = fixture(t);
  setReleaseVersion(f.root, '1.1.0-rc.1');
  assert.equal(f.read('package.json').version, '1.1.0-rc.1');
  assert.equal(f.read('package.json').private, true);
  const pkg = f.read('packages/agent/package.json');
  assert.equal(pkg.private, false); assert.equal(pkg.peerDependencies.external, '1.0.0');
  assert.equal(pkg.peerDependencies['@hachej/boring-files'], '^1.1.0-rc.1');
  const lock = f.read('package-lock.json');
  assert.equal(lock.version, '1.1.0-rc.1'); assert.equal(lock.packages[''].version, lock.version);
  assert.equal(lock.packages['packages/agent'].peerDependencies['@hachej/boring-files'], `^${lock.version}`);
  assert.deepEqual(f.read('registry.json').items[0].dependencies, ['@hachej/boring-files@^1.1.0-rc.1', 'external@1.0.0']);
  assert.deepEqual(f.read('public/r/fixture.json').dependencies, f.read('registry.json').items[0].dependencies);
  // Absolute item URLs of the released package move with it; any other URL is left alone.
  assert.deepEqual(f.read('public/r/fixture.json').registryDependencies, ['https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@1.1.0-rc.1/r/utils.json', 'https://example.test/r/other.json']);
});

test('invalid versions and inconsistent lockfiles leave all source files untouched', t => {
  const f = fixture(t), before = readFileSync(join(f.root, 'package.json'), 'utf8');
  for (const version of ['latest', 'v1.0.0', '1.02.0', '1.0.0-01', '1.0.0+build', '1.0.0; echo unsafe', '999999999999999999999.0.0']) {
    assert.equal(validReleaseVersion(version), false, version); assert.throws(() => setReleaseVersion(f.root, version));
  }
  const lock = f.read('package-lock.json'); delete lock.packages['packages/files']; f.write('package-lock.json', lock);
  assert.throws(() => setReleaseVersion(f.root, '2.0.0'), /Lockfile/);
  assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), before);
  assert.equal(f.read('packages/agent/package.json').version, '1.0.0');
});

test('real audited tarballs support dry-run and reconcile partial publication without blind replay', async t => {
  const f = fixture(t);
  const checked = checkPackages(f.root, { release: true, outputDirectory: f.directory, commit });
  assert.deepEqual(checked.errors, []); assert.equal(checked.packs.length, 2); assert.deepEqual(checked.skipped, ['@hachej/boring-browser']);
  const release = readRelease(f.directory, f.options);
  assert.deepEqual(release.packages, checked.packs);
  await t.test('actual npm publish dry-run does not contact our registry writer', async () => {
    const result = await publishRelease(f.directory, { ...f.options, dryRun: true }, { fetch: () => { throw new Error('Unexpected registry lookup'); } });
    assert.equal(result.dryRun, true);
  });
  await t.test('tampering, mismatched SHA, missing packages, and private manifests are refused', () => {
    const archive = join(f.directory, release.packages[0].filename), original = readFileSync(archive);
    writeFileSync(archive, Buffer.concat([original, Buffer.from('tampered')]));
    assert.throws(() => readRelease(f.directory, f.options), /integrity/); writeFileSync(archive, original);
    assert.throws(() => readRelease(f.directory, { ...f.options, commit: 'b'.repeat(40) }), /commit/);
    assert.throws(() => readRelease(f.directory, { ...f.options, version: '1.0.0-rc.1', tag: 'latest' }), /prereleases/);
    const saved = readFileSync(join(f.directory, 'release.json'));
    f.write('archives/release.json', { ...release, packages: release.packages.slice(1) });
    assert.throws(() => readRelease(f.directory, f.options), /every publishable workspace/); writeFileSync(join(f.directory, 'release.json'), saved);
    const pkg = f.read('packages/agent/package.json'); f.write('packages/agent/package.json', { ...pkg, private: true });
    assert.throws(() => readRelease(f.directory, f.options), /reviewed source/); f.write('packages/agent/package.json', pkg);
  });
  await t.test('registry outages or conflicting immutable versions prevent every publication', async () => {
    let writes = 0;
    await assert.rejects(publishRelease(f.directory, f.options, { fetch: async () => new Response('unavailable', { status: 503 }), run: () => { writes++; } }), /lookup failed/);
    await assert.rejects(publishRelease(f.directory, f.options, { fetch: async url => Response.json({ name: decodeURIComponent(new URL(url).pathname.split('/')[1]), version: '1.0.0', dist: { integrity: 'different' } }), run: () => { writes++; } }), /different integrity/);
    assert.equal(writes, 0);
  });
  await t.test('lost acknowledgement is recorded and retry skips only matching published bytes and tag', async () => {
    const registry = new Map(), writes = [], receipts = [];
    const fetch = async url => {
      const parts = new URL(url).pathname.slice(1).split('/'), name = decodeURIComponent(parts[0]);
      return registry.has(name) ? Response.json(registry.get(name)) : new Response('missing', { status: 404 });
    };
    let loseAck = true;
    const run = (command, args) => {
      assert.equal(command, 'npm'); assert.ok(args.includes('--ignore-scripts'));
      const pack = release.packages.find(pack => args[1] === join(f.directory, pack.filename)); assert.ok(pack);
      writes.push(pack.name); registry.set(pack.name, { name: pack.name, version: pack.version, dist: { integrity: pack.integrity } });
      const status = loseAck ? 1 : 0; loseAck = false; return { status, stdout: JSON.stringify({ error: { code: 'E503', summary: 'fictional-secret-not-for-logs' } }) };
    };
    await assert.rejects(publishRelease(f.directory, f.options, { fetch, run, record: value => receipts.push(value) }), /unconfirmed/);
    assert.equal(receipts.at(-1).packages[0].status, 'unconfirmed');
    assert.equal(receipts.at(-1).packages[0].diagnostic.errorCode, 'E503');
    assert.ok(!JSON.stringify(receipts).includes('fictional-secret-not-for-logs'));
    const result = await publishRelease(f.directory, f.options, { fetch, run });
    assert.deepEqual(result.packages.map(pack => pack.status), ['already-published', 'published']);
    assert.equal(writes.length, 2);
    await publishRelease(f.directory, f.options, { fetch, run }); assert.equal(writes.length, 2);
    await assert.rejects(publishRelease(f.directory, f.options, { fetch: async url => url.endsWith('/next') ? new Response('missing', { status: 404 }) : fetch(url), run }), /dist-tag/);
    assert.equal(writes.length, 2);
  });
});

test('publish waits for the registry to confirm each package before failing', async t => {
  const f = fixture(t);
  checkPackages(f.root, { release: true, outputDirectory: f.directory, commit });
  const release = readRelease(f.directory, f.options);
  const options = f.options, timing = { confirmIntervalMs: 1, confirmTimeoutMs: 50 };
  const publish = (lookupsBeforeVisible, { never = false } = {}) => {
    const registry = new Map(), lookups = new Map(), sleeps = [];
    const fetch = async url => {
      const parts = new URL(url).pathname.slice(1).split('/'), name = decodeURIComponent(parts[0]);
      if (!registry.has(name)) return new Response('missing', { status: 404 });
      const count = (lookups.get(name) ?? 0) + 1; lookups.set(name, count);
      return count <= lookupsBeforeVisible || never ? new Response('missing', { status: 404 }) : Response.json(registry.get(name));
    };
    const run = (command, args) => {
      const pack = release.packages.find(pack => args[1] === join(f.directory, pack.filename));
      registry.set(pack.name, { name: pack.name, version: pack.version, dist: { integrity: pack.integrity } });
      return { status: 0, stdout: '{}' };
    };
    const sleep = async ms => { sleeps.push(ms); };
    return publishRelease(f.directory, options, { fetch, run, sleep, ...timing }).then(result => ({ result, sleeps }));
  };
  await t.test('not visible on the first lookup, visible on a later one, succeeds', async () => {
    const { result, sleeps } = await publish(2);
    assert.deepEqual(result.packages.map(pack => pack.status), ['published', 'published']);
    assert.ok(sleeps.length > 0 && sleeps.every(ms => ms === 1));
  });
  await t.test('never visible fails with the same error after the timeout', async () => {
    await assert.rejects(publish(0, { never: true }), /Registry has not confirmed package\/version\/tag for /);
  });
});

test('private release candidates produce no retained publishable artifact', t => {
  const f = fixture(t), pkg = f.read('packages/files/package.json'); f.write('packages/files/package.json', { ...pkg, private: true });
  const result = checkPackages(f.root, { release: true, outputDirectory: f.directory, commit });
  assert.ok(result.errors.some(error => error.includes('private must explicitly be false')));
  assert.throws(() => readFileSync(join(f.directory, 'release.json')), { code: 'ENOENT' });
});

test('an intentionally private package that turns public is refused, and one that stays private is never packed', t => {
  const f = fixture(t);
  const ok = checkPackages(f.root, { release: true, outputDirectory: f.directory, commit });
  assert.deepEqual(ok.errors, []); assert.ok(!ok.packs.some(pack => pack.name.endsWith('browser')));
  assert.deepEqual(f.read('archives/release.json').skippedPrivate, ['@hachej/boring-browser']);
  const pkg = f.read('packages/browser/package.json'); f.write('packages/browser/package.json', { ...pkg, private: false });
  const bad = checkPackages(f.root, { release: true });
  assert.ok(bad.errors.some(error => error.includes('must stay private')));
});

test('a published package may not depend on an intentionally private package', t => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const f = fixture(t), pkg = f.read('packages/files/package.json');
    f.write('packages/files/package.json', { ...pkg, [field]: { '@hachej/boring-browser': '1.0.0' } });
    const result = checkPackages(f.root, { release: true, outputDirectory: f.directory, commit });
    assert.ok(result.errors.some(error => error.includes('must not depend on private package') && error.includes(field)), field);
    assert.throws(() => readFileSync(join(f.directory, 'release.json')), { code: 'ENOENT' });
  }
});

test('a private package injected into the release artifact is refused by the publisher and the workflow guard', t => {
  const f = fixture(t);
  checkPackages(f.root, { release: true, outputDirectory: f.directory, commit });
  const release = f.read('archives/release.json');
  const injected = { ...release, packages: [...release.packages, { ...release.packages[0], name: '@hachej/boring-browser', filename: 'boring-browser-1.0.0.tgz' }] };
  f.write('archives/release.json', injected);
  assert.throws(() => readRelease(f.directory, f.options), /publishable workspace|Unexpected/);
  const guard = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/release-set.mjs', import.meta.url)), f.directory], { encoding: 'utf8' });
  assert.equal(guard.status, 1); assert.match(guard.stderr, /boring-browser/);
});

test('the publisher and everything it imports start with no node_modules reachable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-publisher-isolated-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../../scripts/', import.meta.url));
  cpSync(source, join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  // Bad arguments make the publisher throw its usage error, which proves its whole import graph resolved.
  const result = spawnSync(process.execPath, [join(dir, 'scripts', 'publish-npm-packages.mjs')], { encoding: 'utf8', cwd: dir });
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/);
  assert.match(result.stderr, /Usage: node scripts\/publish-npm-packages\.mjs/);
});

// The GitHub release job: its step script runs here against a stub `gh`, so the idempotency and channel logic is executed, not just grepped.
const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
function workflowJob(name) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `job ${name} exists`);
  let end = start + 1;
  while (end < lines.length && !/^\S/.test(lines[end]) && !/^  \S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}
function stepScript(job, stepName) {
  const lines = workflowJob(job).split('\n');
  const at = lines.findIndex(line => line.includes(`- name: ${stepName}`));
  assert.notEqual(at, -1, `step ${stepName}`);
  const run = lines.findIndex((line, index) => index > at && line.trimStart().startsWith('run: |'));
  const indent = lines[run].search(/\S/);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return body.join('\n');
}
function runGithubRelease(t, { version, tag, exists = false, pr = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'boring-gh-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'gh.log');
  writeFileSync(join(dir, 'gh'), [
    '#!/bin/sh',
    `printf '%s|' "$@" >> '${log}'; printf '\\n' >> '${log}'`,
    'case "$1" in',
    '  api) printf "%s\\n" "$STUB_PR" ;;',
    '  pr) printf "Release notes body\\n" ;;',
    '  release) if [ "$2" = view ]; then [ "$STUB_RELEASE_EXISTS" = 1 ]; fi ;;',
    'esac',
  ].join('\n'));
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(join(dir, 'step.sh'), stepScript('github-release', 'Create the GitHub release once'));
  const result = spawnSync('bash', [join(dir, 'step.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_REPOSITORY: 'hachej/boring-ui', GH_REPO: 'hachej/boring-ui',
      RELEASE_VERSION: version, RELEASE_TAG: tag, RELEASE_COMMIT: commit, STUB_PR: pr, STUB_RELEASE_EXISTS: exists ? '1' : '0',
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => line.split('|').filter(Boolean)) : [];
  return { status: result.status, stderr: result.stderr, calls, create: calls.find(args => args[0] === 'release' && args[1] === 'create') };
}

test('a github-release job publishes the GitHub release only after a successful publish', () => {
  const job = workflowJob('github-release');
  assert.match(job, /^    needs: publish$/m);
  assert.match(job, /^    if: needs\.publish\.result == 'success'$/m);
  assert.match(job, /^    permissions:\n      contents: write$/m);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1, 'only the github-release job gets write access');
  assert.match(workflowJob('publish'), /^    permissions:\n      contents: read\n      id-token: write$/m);
  assert.match(job, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(job, /secrets\./);
});

test('the GitHub release step is idempotent: an existing release is left alone', t => {
  const result = runGithubRelease(t, { version: '9.9.9', tag: 'latest', exists: true, pr: '123' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.create, undefined);
});

test('a latest publish creates a Latest release with the merged release PR body', t => {
  const result = runGithubRelease(t, { version: '9.9.9', tag: 'latest', pr: '123' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.find(args => args[0] === 'api').slice(0, 2), ['api', `repos/hachej/boring-ui/commits/${commit}/pulls`]);
  assert.deepEqual(result.calls.find(args => args[0] === 'pr'), ['pr', 'view', '123', '--json', 'body', '--jq', '.body']);
  assert.ok(result.create, 'release create was called');
  assert.deepEqual(result.create.slice(0, 6), ['release', 'create', 'v9.9.9', '--target', commit, '--title']);
  assert.ok(result.create.includes('--latest'));
  assert.ok(!result.create.includes('--prerelease') && !result.create.includes('--latest=false'));
  assert.ok(result.create.includes('--notes-file') && !result.create.includes('--generate-notes'));
});

test('a non-latest dist-tag creates a prerelease that is never Latest, and falls back to generated notes', t => {
  const result = runGithubRelease(t, { version: '9.9.9-next.1', tag: 'next', pr: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.create, 'release create was called');
  assert.ok(result.create.includes('--prerelease') && result.create.includes('--latest=false'));
  assert.ok(!result.create.includes('--latest'));
  assert.ok(result.create.includes('--generate-notes') && !result.create.includes('--notes-file'));
});
