import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

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
  const actual = [...job.matchAll(/npm run ([\w:-]+)/g)].map(match => match[1]).filter(name => name !== 'build');
  assert.deepEqual(actual.sort(), [...journeys].sort());
  const shards = ['studio-1', 'studio-2', 'design', 'workspace', 'documents'];
  const assignments = new Map(journeys.map(name => [name, []]));
  for (const step of job.split(/(?=^      -)/m)) {
    const command = /npm run ([\w:-]+)/.exec(step)?.[1];
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
  assert.match(release, /needs: \[prepare, verify, browser, secrets\]/);
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
