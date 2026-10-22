import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { REQUIRED_CHECKS } from '../../scripts/release-admission.mjs';

const root = new URL('../../', import.meta.url);
const workflow = name => readFileSync(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
function jobs(source) {
  return Object.fromEntries([...source.slice(source.indexOf('jobs:\n') + 6).matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
}
function script(job, name) {
  const lines = job.split('\n');
  const start = lines.findIndex(line => line === `      - name: ${name}`);
  assert.notEqual(start, -1, name);
  const run = lines.findIndex((line, i) => i > start && line === '        run: |');
  assert.notEqual(run, -1, `${name} has a shell script`);
  const end = lines.findIndex((line, i) => i > run && line.trim() && !line.startsWith('          '));
  return lines.slice(run + 1, end === -1 ? undefined : end).map(line => line.slice(10)).join('\n');
}
const journeys = [
  'test:design', 'test:viewer-chrome', 'app-shell:journey', 'app-shell:journey:workspace', 'workspace-app:journey',
  'shared-chat:journey', 'mockup:journey', 'draft-recovery:journey', 'file-tree:journey', 'canvas:journey:commands',
  'canvas:journey:proposals', 'canvas:journey:remote', 'board:journey', 'task-list:journey', 'morning:journey',
  'studio:journey:correctness', 'studio:journey:scripted', 'workspace-demo:journey', 'ambient:journey:scripted',
];
const consumers = 'document editor html virtual remote-shell remote-files question presentation experience canvas canvas-editor canvas-remote task-list-registry morning pi-chat shared-chat'.split(' ');

test('browser matrix preserves every journey command and scopes every evidence artifact to its shard', () => {
  const source = workflow('studio-scripted');
  const job = jobs(source)['scripted-journeys'];
  assert.match(job, /fail-fast: false/);
  assert.match(job, /shard: \[studio-1, studio-2, design, workspace, documents\]/);
  const actual = [...job.matchAll(/(?:npm run |node scripts\/retry-journey\.mjs )([\w:-]+)/g)].map(match => match[1]).filter(name => name !== 'build');
  assert.deepEqual(actual.sort(), [...journeys].sort());
  const shards = ['studio-1', 'studio-2', 'design', 'workspace', 'documents'];
  const assignments = new Map(journeys.map(name => [name, []]));
  for (const step of job.split(/(?=^      -)/m)) {
    const command = /(?:npm run |node scripts\/retry-journey\.mjs )([\w:-]+)/.exec(step)?.[1];
    if (!assignments.has(command)) continue;
    const condition = /^        if: (.+)$/m.exec(step)?.[1];
    assert.ok(condition, `${command} has a shard selector`);
    const selected = shards.filter(shard => condition === `matrix.shard == '${shard}'` || (condition === "startsWith(matrix.shard, 'studio-')" && shard.startsWith('studio-')));
    assert.ok(selected.length > 0, `${command}: ${condition}`);
    assignments.get(command).push(...selected);
  }
  for (const [command, selected] of assignments) assert.equal(selected.length, command === 'studio:journey:scripted' ? 2 : 1, command);
  for (const match of job.matchAll(/uses: actions\/upload-artifact@[^\n]+\n        with:\n          name: (.+)/g)) {
    assert.ok(match[1].includes('${{ matrix.shard }}'), match[1]);
  }
  for (const path of ['shadcn-first', 'feat-board-viewer', 'canvas-browser', 'canvas-proposals-browser', 'canvas-remote-browser', 'task-list-browser', 'morning-browser', 'draft-recovery-browser', 'file-tree-browser', 'library']) assert.ok(job.includes(path), path);
  assert.match(job, /key: chromium-headless-shell-1243-playwright-/);
  assert.equal((job.match(/run: npm run build/g) ?? []).length, 1);
});

test('the actual studio step partitions the auto-discovered scenarios and UI journeys without omissions', async t => {
  const job = jobs(workflow('studio-scripted'))['scripted-journeys'];
  const body = script(job, 'Studio journeys with the scripted model');
  const directory = mkdtempSync(join(tmpdir(), 'boring-ci-studio-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$STUDIO_ONLY"\n');
  chmodSync(join(directory, 'npm'), 0o755);
  const selected = [0, 1].map(part => {
    const ran = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', body], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, STUDIO_PART: String(part) } });
    assert.equal(ran.status, 0, ran.stderr);
    return ran.stdout.trim().split(',');
  });
  const { loadScenarios } = await import('../../lab/studio/scenarios/index.mjs');
  const { JOURNEYS } = await import('../../lab/studio/journeys/index.mjs');
  const expected = [...Object.keys(JOURNEYS), ...(await loadScenarios()).map(scenario => scenario.id)];
  assert.ok(selected.every(part => part.length > 0));
  assert.equal(new Set(selected.flat()).size, expected.length);
  assert.deepEqual(selected.flat().sort(), expected.sort());
  const invalid = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', body], { cwd: root, encoding: 'utf8', env: { ...process.env, STUDIO_PART: '2' } });
  assert.notEqual(invalid.status, 0);
});

test('a phone scenario clears the previous desktop conversation before changing its viewport', async () => {
  const { runScenario } = await import('../../lab/studio/journey-scenarios.mjs');
  const events = [];
  let viewport = 'desktop';
  const t = {
    step: async (_, run) => run(),
    device: async next => { viewport = next; events.push(`device:${next}`); },
    fresh: async () => { events.push(`fresh:${viewport}`); assert.equal(viewport, 'desktop', 'the previous desktop file must close while its Close control is visible'); },
    reload: async () => events.push('reload'),
    browser: { until: async () => {}, evaluate: async () => 'true', screenshot: async () => events.push('screenshot') },
  };
  const scenario = { id: 'fixture-phone', title: 'Phone setup', viewport: 'phone', steps: [{ prompt: 'fixture', run: async () => events.push(`run:${viewport}`) }] };
  await runScenario(t, scenario, { id: 'local' }, () => {}, { retries: 0 });
  assert.deepEqual(events, ['fresh:desktop', 'device:phone', 'run:phone', 'screenshot', 'device:desktop', 'reload']);
});

test('studio scenarios retry once in a fresh conversation, log it, and fail on the second attempt', async t => {
  const { runScenario } = await import('../../lab/studio/journey-scenarios.mjs');
  const logs = [];
  t.mock.method(console, 'log', value => logs.push(value));
  t.mock.method(console, 'error', () => {});
  for (const failures of [0, 1, 2]) {
    let attempts = 0, fresh = 0;
    logs.length = 0;
    const toolkit = {
      step: async (_, run) => run(), fresh: async () => { fresh++; },
      browser: { until: async () => {}, evaluate: async () => 'true', screenshot: async () => {} },
    };
    const scenario = { id: 'fictional-flake', title: 'Fixture', steps: [{ prompt: 'fixture', run: async () => { if (++attempts <= failures) throw new Error('fictional failure'); } }] };
    const result = runScenario(toolkit, scenario, { id: 'local' }, () => {});
    if (failures === 2) await assert.rejects(result, /fictional failure/);
    else await result;
    assert.equal(attempts, failures === 0 ? 1 : 2);
    assert.equal(fresh, attempts);
    assert.deepEqual(logs, failures === 0 ? [] : ['retried after flake: fictional-flake']);
    await assert.rejects(runScenario(toolkit, scenario, { id: 'local' }, () => {}, { retries: 2 }), /at most one retry/);
  }
});

test('the journey command wrapper reruns only its failed journey, never unit tests', t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-journey-retry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, 'calls');
  writeFileSync(join(directory, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n[ "$ALWAYS_FAIL" != 1 ] && [ "$(wc -l < "$CALLS")" -gt "$FAILURES" ]\n');
  chmodSync(join(directory, 'npm'), 0o755);
  const run = (name, failures, always = false) => {
    writeFileSync(log, '');
    return spawnSync(process.execPath, [new URL('scripts/retry-journey.mjs', root).pathname, name], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CALLS: log, FAILURES: String(failures), ALWAYS_FAIL: always ? '1' : '0' } });
  };
  for (const failures of [0, 1]) {
    const result = run('mockup:journey', failures);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, failures + 1);
    assert.equal(result.stdout.includes('retried after flake: mockup:journey'), failures === 1);
  }
  assert.equal(run('mockup:journey', 2, true).status, 1);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
  for (const name of ['test', 'test:document-consumer', 'studio:journey:scripted']) {
    assert.equal(run(name, 0).status, 1);
    assert.equal(readFileSync(log, 'utf8'), '');
  }
});

test('consumer kinds are disjoint and retain every original consumer plus the installed workspace recipes', t => {
  const job = jobs(workflow('verify'))['isolated-consumers'];
  assert.match(job, /fail-fast: false/);
  const groups = [...job.matchAll(/consumers: ([\w -]+)/g)].map(match => match[1].trim().split(' '));
  assert.ok(groups.length >= 3);
  assert.deepEqual(groups.flat().sort(), [...consumers].sort());
  assert.equal(new Set(groups.flat()).size, consumers.length);
  assert.match(job, /for name in \$CONSUMERS; do/);
  assert.match(job, /npm run "test:\$name-consumer"/);
  assert.match(job, /npm run registry:build\n          npm run test:app-registry-consumer/);
  assert.match(job, /npm run check:pack/);
  const directory = mkdtempSync(join(tmpdir(), 'boring-ci-consumers-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, 'commands');
  writeFileSync(join(directory, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n[ "$2" != "$FAIL_CONSUMER" ]\n');
  chmodSync(join(directory, 'npm'), 0o755);
  const run = (names, failed = '') => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script(job, 'Consumers')], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COMMAND_LOG: log, CONSUMERS: names.join(' '), FAIL_CONSUMER: failed } });
  for (const names of groups) assert.equal(run(names).status, 0);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').sort(), consumers.map(name => `run test:${name}-consumer`).sort());
  assert.notEqual(run(groups[0], `test:${groups[0][0]}-consumer`).status, 0, 'a failing consumer fails its shard');
});

test('verification jobs separate checks, unregistered tests and strict registered release evidence', () => {
  const all = jobs(workflow('verify'));
  assert.match(all.verify, /npm run check/);
  assert.match(all.verify, /npm run typecheck/);
  assert.match(all.verify, /npm run test:design/);
  assert.doesNotMatch(all.verify, /npm (?:test|run verify)(?:\s|$)/);
  assert.match(all.tests, /npm test -- --exclude-registered/);
  assert.match(all['release-gate'], /node scripts\/verify-invariants\.mjs --release/);
  assert.match(all['release-gate'], /Runtime verification INCOMPLETE: \$pending deferred proofs/);
  assert.match(all['release-gate'], /node scripts\/probe-vfs-git\.mjs/);
  assert.match(all['demo-worker'], /wrangler deploy --dry-run/);
  const release = workflow('release');
  assert.match(release, /uses: \.\/\.github\/workflows\/verify\.yml/);
  assert.match(release, /uses: \.\/\.github\/workflows\/studio-scripted\.yml/);
  assert.match(release, /needs: \[admit, prepare, verify, browser, secrets\]/);
  assert.doesNotMatch(jobs(release).prepare, /release:preflight|verify:release|npm test/);
  assert.match(jobs(release).prepare, /npm run typecheck/);
  assert.match(jobs(release).prepare, /check-npm-packages\.mjs --release --out/);
});

test('release admission names every current main-push job, including every matrix expansion', () => {
  for (const [file, names] of Object.entries(REQUIRED_CHECKS)) {
    const source = workflow(file.replace('.yml', ''));
    const actual = Object.entries(jobs(source)).flatMap(([id, job]) => {
      const name = /^    name: (.+)$/m.exec(job)?.[1] ?? id;
      if (name.includes('${{ matrix.shard }}')) return ['studio-1', 'studio-2', 'design', 'workspace', 'documents'].map(value => name.replace('${{ matrix.shard }}', value));
      if (name.includes('${{ matrix.kind }}')) return [...job.matchAll(/- kind: (.+)/g)].map(match => name.replace('${{ matrix.kind }}', match[1]));
      return name;
    });
    assert.deepEqual([...names].sort(), actual.sort());
  }
});

test('the actual release publish condition admits reused green checks or a fully green fallback, never missing evidence', () => {
  const all = jobs(workflow('release'));
  for (const id of ['verify', 'browser']) assert.match(all[id], /if: needs.admit.outputs.reuse-ci != 'true'/);
  assert.match(all.admit, /actions: read\n      checks: read/);
  assert.match(all.admit, /run: node scripts\/release-admission.mjs/);
  assert.match(all.admit, /REVIEWED_COMMIT: \$\{\{ inputs.commit \}\}/);
  const expression = /if: >-\n([\s\S]*?)\n    needs:/.exec(all.publish)[1].trim()
    .replaceAll('needs.admit.outputs.reuse-ci', 'needs.admit.outputs["reuse-ci"]')
    .replaceAll('always()', 'true').replaceAll('cancelled()', 'cancelled');
  const allows = new Function('needs', 'cancelled', 'github', `return (${expression});`);
  const github = { repository: 'hachej/boring-ui', ref: 'refs/heads/main', actor: 'hachej', triggering_actor: 'hachej' };
  const statuses = ['success', 'failure', 'skipped', 'cancelled', ''];
  for (const reuse of ['true', 'false', '']) for (const admit of statuses) for (const prepare of statuses) for (const secrets of statuses) for (const verify of statuses) for (const browser of statuses) {
    const needs = { admit: { result: admit, outputs: { 'reuse-ci': reuse } }, prepare: { result: prepare }, secrets: { result: secrets }, verify: { result: verify }, browser: { result: browser } };
    const expected = admit === 'success' && prepare === 'success' && secrets === 'success' && ((reuse === 'true' && verify === 'skipped' && browser === 'skipped') || (reuse === 'false' && verify === 'success' && browser === 'success'));
    assert.equal(allows(needs, false, github), expected, JSON.stringify(needs));
    assert.equal(allows(needs, true, github), false);
    assert.equal(allows(needs, false, { ...github, triggering_actor: 'fictional' }), false);
  }
});

test('only browser journey commands gain retry wrappers; studio retries scenarios, not the full shard', () => {
  const job = jobs(workflow('studio-scripted'))['scripted-journeys'];
  const wrapped = [...job.matchAll(/node scripts\/retry-journey\.mjs ([\w:-]+)/g)].map(match => match[1]);
  assert.deepEqual(wrapped.sort(), journeys.filter(name => name.includes(':journey') && name !== 'studio:journey:scripted').sort());
  assert.match(job, /npm run studio:journey:scripted/);
  assert.doesNotMatch(workflow('verify'), /retry-journey/);
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.scripts['release:preflight'], 'npm run check && npm run typecheck && node scripts/release-preflight.mjs');
  assert.match(jobs(workflow('verify')).verify, /fetch-depth: 0/);
  assert.match(jobs(workflow('verify')).verify, /node scripts\/check-release-notes.mjs/);
});

test('all branch-protection check names remain exact, non-matrix job display names', () => {
  const names = ['verify', 'studio-scripted', 'secrets'].flatMap(name => Object.values(jobs(workflow(name))).flatMap(job => /^    name: (.+)$/m.exec(job)?.[1] ?? []));
  for (const required of ['verify', 'Isolated package consumers', 'Studio scripted journeys', 'Secret scan']) {
    assert.equal(names.filter(name => name === required).length, 1, required);
  }
});

test('the consumer aggregate reports every matrix outcome and remains required by ci-ok', () => {
  const all = jobs(workflow('verify'));
  const gate = all['isolated-consumers-ok'];
  assert.ok(gate, 'consumer aggregate exists');
  assert.match(gate, /^    name: Isolated package consumers$/m);
  assert.match(gate, /if: always\(\)/);
  assert.match(gate, /needs: \[isolated-consumers\]/);
  assert.match(gate, /NEEDS_RESULTS: \$\{\{ join\(needs\.\*\.result, ' '\) \}\}/);
  assert.ok(/needs: \[([^\]]+)\]/.exec(all['ci-ok'])[1].split(',').map(name => name.trim()).includes('isolated-consumers-ok'));
  const body = script(gate, 'Require every job to succeed');
  assert.equal(body, script(all['ci-ok'], 'Require every job to succeed'));
  for (const [results, success] of [['success', true], ['failure', false], ['cancelled', false], ['skipped', false], ['', false]]) {
    const ran = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', body], { encoding: 'utf8', env: { ...process.env, NEEDS_RESULTS: results } });
    assert.equal(ran.status === 0, success, `${results}: ${ran.stderr}`);
  }
});

for (const name of ['verify', 'studio-scripted']) test(`${name} ci-ok needs all jobs and rejects failed, cancelled, skipped or absent results`, () => {
  const all = jobs(workflow(name));
  const gate = all['ci-ok'];
  assert.ok(gate, 'ci-ok job exists');
  assert.match(gate, new RegExp(`^    name: ${name === 'verify' ? 'verify' : 'Studio scripted journeys'}$`, 'm'));
  assert.match(gate, /if: always\(\)/);
  const needs = /needs: \[([^\]]+)\]/.exec(gate)?.[1].split(',').map(value => value.trim());
  assert.deepEqual(needs?.sort(), Object.keys(all).filter(key => key !== 'ci-ok').sort());
  assert.match(gate, /NEEDS_RESULTS: \$\{\{ join\(needs\.\*\.result, ' '\) \}\}/);
  const body = script(gate, 'Require every job to succeed');
  for (const [results, success] of [['success success', true], ['success failure', false], ['cancelled success', false], ['skipped', false], ['', false]]) {
    const ran = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', body], { encoding: 'utf8', env: { ...process.env, NEEDS_RESULTS: results } });
    assert.equal(ran.status === 0, success, `${results}: ${ran.stderr}`);
  }
});
