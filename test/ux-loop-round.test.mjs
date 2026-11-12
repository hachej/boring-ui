import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedFiles, commitRound, discard, failingTests, forbiddenTouched, retried, runRound, waitForLoad } from '../ux/runner/loop-round.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'ux-loop-')); git(cwd, 'init', '-q', '-b', 'main');
  mkdirSync(join(cwd, 'registry')); mkdirSync(join(cwd, 'ux/runner'), { recursive: true });
  writeFileSync(join(cwd, 'registry/a.tsx'), 'one\n'); writeFileSync(join(cwd, 'registry/b.tsx'), 'two\n'); writeFileSync(join(cwd, 'ux/runner/loop.mjs'), 'exam\n');
  git(cwd, 'add', '-A'); git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'start');
  return cwd;
}
const edit = cwd => { writeFileSync(join(cwd, 'registry/a.tsx'), 'one edited\n'); writeFileSync(join(cwd, 'registry/new.tsx'), 'new\n'); };
const back = (cwd, start) => { assert.equal(git(cwd, 'rev-parse', 'HEAD'), start); assert.equal(git(cwd, 'status', '--porcelain'), ''); assert.equal(git(cwd, 'stash', 'list'), ''); };

test('a worker that only edits files gets a commit in its name; the round is not empty', async () => {
  const cwd = repo(), start = git(cwd, 'rev-parse', 'HEAD');
  const rec = await runRound({ cwd, runWorker: async () => edit(cwd), runChecks: async () => [] });
  assert.equal(rec.status, 'ready'); assert.deepEqual(rec.changed, ['registry/a.tsx', 'registry/new.tsx']);
  const sha = commitRound({ cwd, n: 3, target: 'layout:bar', model: 'gpt-6.1-sol', body: 'what changed' });
  assert.notEqual(git(cwd, 'rev-parse', 'HEAD'), start);
  assert.match(git(cwd, 'log', '-1', '--format=%an|%s'), /^gpt-6\.1-sol \(UX loop round 3\)\|UX round 3 \(layout:bar\): 2 files edited by gpt-6\.1-sol$/);
  assert.equal(git(cwd, 'rev-parse', '--short', 'HEAD'), sha);
  assert.equal(commitRound({ cwd, n: 4, target: 'layout:bar', model: 'm' }), null, 'never an empty commit');
});

test('a worker that changes nothing is "no change", not a failure', async () => {
  const cwd = repo(); let checked = false;
  const rec = await runRound({ cwd, runWorker: async () => {}, runChecks: async () => { checked = true; return []; } });
  assert.equal(rec.status, 'no-change'); assert.equal(checked, false);
});

test('a failing check goes back to the worker once, with the full output, in the same round', async () => {
  const cwd = repo(), calls = [], saved = {};
  const rec = await runRound({
    cwd, save: (name, text) => { saved[name] = text; },
    runWorker: async ({ feedback, tag }) => { calls.push([tag, feedback]); if (!feedback) edit(cwd); else writeFileSync(join(cwd, 'registry/a.tsx'), 'repaired\n'); },
    runChecks: async () => readFileSync(join(cwd, 'registry/a.tsx'), 'utf8').startsWith('repaired') ? [] : [{ name: 'contract tests', output: 'not ok 7 - K-3 (test/x.test.mjs:12:3)\nexpected 1 got 2' }],
  });
  assert.equal(rec.status, 'ready'); assert.equal(calls.length, 2); assert.equal(calls[1][0], '-repair'); assert.match(calls[1][1], /K-3.*test\/x\.test\.mjs:12:3/s);
  assert.match(saved['failure-1.txt'], /expected 1 got 2/);
});

test('still failing after the repair: edits discarded, files and start commit back, nothing stashed', async () => {
  const cwd = repo(), start = git(cwd, 'rev-parse', 'HEAD'); let workers = 0;
  const rec = await runRound({ cwd, runWorker: async () => { workers++; edit(cwd); git(cwd, 'add', 'registry/new.tsx'); }, runChecks: async () => [{ name: 'npm run check', output: 'boom' }] });
  assert.equal(rec.status, 'failed'); assert.match(rec.reason, /npm run check still failing/); assert.equal(workers, 2);
  back(cwd, start); assert.equal(readFileSync(join(cwd, 'registry/a.tsx'), 'utf8'), 'one\n'); assert.equal(existsSync(join(cwd, 'registry/new.tsx')), false);
});

test('a round that touches the exam is refused without a repair and discarded', async () => {
  const cwd = repo(), start = git(cwd, 'rev-parse', 'HEAD'); let workers = 0, checked = false;
  const rec = await runRound({ cwd, runWorker: async () => { workers++; edit(cwd); writeFileSync(join(cwd, 'ux/runner/loop.mjs'), 'easier exam\n'); }, refuse: changed => forbiddenTouched(changed).map(f => `touched ${f}`), runChecks: async () => { checked = true; return []; } });
  assert.equal(rec.status, 'failed'); assert.match(rec.reason, /refused: touched ux\/runner\/loop\.mjs/); assert.equal(workers, 1); assert.equal(checked, false);
  back(cwd, start); assert.equal(readFileSync(join(cwd, 'ux/runner/loop.mjs'), 'utf8'), 'exam\n');
});

test('a regression judged after the checks is reverted the same way', async () => {
  const cwd = repo(), start = git(cwd, 'rev-parse', 'HEAD');
  const rec = await runRound({ cwd, runWorker: async () => { edit(cwd); writeFileSync(join(cwd, 'registry/b.tsx'), ''); }, runChecks: async () => [] });
  assert.equal(rec.status, 'ready'); assert.deepEqual(changedFiles(cwd), ['registry/a.tsx', 'registry/b.tsx', 'registry/new.tsx']);
  discard(cwd, rec.start); back(cwd, start); assert.equal(readFileSync(join(cwd, 'registry/b.tsx'), 'utf8'), 'two\n');
});

test('failing tests come out of a TAP run with their assertion and location', () => {
  const tap = ['# Subtest: a', 'ok 1 - a', '# Subtest: K-3', 'not ok 2 - K-3, 390: the field stays', '  ---', '  error: expected 44 got 30', '  stack: |-', '    at file:///wt/test/contracts/one-composer.test.mjs:210:5', '  ...', 'ok 3 - c', '1..3'].join('\n');
  const found = failingTests(tap); assert.equal(found.length, 1); assert.match(found[0], /K-3, 390.*expected 44 got 30.*one-composer\.test\.mjs:210:5/s); assert.doesNotMatch(found[0], /ok 3/);
});

test('the capture waits for the load to fall, within a bound, and a crash is retried once', async () => {
  let slept = 0;
  assert.equal(await waitForLoad({ max: 25, load: () => 40 - slept * 10, sleep: async () => { slept++; }, step: 1000 }), 2000); assert.equal(slept, 2);
  assert.equal(await waitForLoad({ max: 25, timeoutMs: 3000, load: () => 99, sleep: async () => {}, step: 1000 }), 3000);
  let tries = 0; assert.equal(await retried(async () => { if (++tries === 1) throw new Error('page crashed'); return 'ok'; }), 'ok');
  await assert.rejects(retried(async () => { throw new Error('again'); }), /again/);
});
