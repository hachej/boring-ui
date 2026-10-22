import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseAdmission, REQUIRED_CHECKS, testedPullRequestHead } from '../../scripts/release-admission.mjs';

const commit = 'a'.repeat(40), repository = 'hachej/boring-ui';
const input = { commit, sha: commit, repository, token: 'fictional-workflow-token' };
function fixture() {
  const pages = new Map(), calls = [];
  const suites = Object.keys(REQUIRED_CHECKS).map((_, index) => ({ id: index + 1, head_sha: commit, app: { slug: 'github-actions' } }));
  pages.set(`commits/${commit}/check-suites`, { check_suites: suites });
  Object.entries(REQUIRED_CHECKS).forEach(([workflow, names], index) => {
    pages.set(`actions/workflows/${workflow}/runs`, { workflow_runs: [{ id: index + 10, check_suite_id: index + 1, head_sha: commit, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', repository: { full_name: repository } }] });
    pages.set(`check-suites/${index + 1}/check-runs`, { check_runs: names.map(name => ({ name, head_sha: commit, check_suite: { id: index + 1 }, status: 'completed', conclusion: 'success' })) });
  });
  const fetch = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname.replace(`/repos/${repository}/`, '');
    assert.equal(options.headers.authorization, `Bearer ${input.token}`);
    assert.equal(parsed.searchParams.get('per_page'), '100');
    calls.push(url);
    if (path.includes('/runs')) {
      assert.equal(parsed.searchParams.get('head_sha'), commit);
    }
    return Response.json(pages.get(`${path}:${parsed.searchParams.get('page') ?? '1'}`) ?? pages.get(path));
  };
  // A fictional clock: each wait advances it, so a run that never completes reaches the deadline at once.
  let clock = 0;
  return { pages, calls, fetch, now: () => clock, sleep: async ms => { clock += ms; } };
}

test('fixture main commit admits only the complete named verify and browser suites', async () => {
  const f = fixture();
  assert.equal((await releaseAdmission(input, f)).reuse, true);
  assert.equal(f.calls.length, 6);
  assert.ok(f.calls.every(url => !new URL(url).searchParams.has('page')), 'omit explicit page=1, which GitHub can mis-handle with head_sha');
  const verify = readFileSync(new URL('../../.github/workflows/verify.yml', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('../../.github/workflows/studio-scripted.yml', import.meta.url), 'utf8');
  for (const name of REQUIRED_CHECKS['verify.yml']) assert.ok(verify.includes(name) || ['tests', 'release-gate'].includes(name) || name.startsWith('Isolated package consumers ('), name);
  for (const name of REQUIRED_CHECKS['studio-scripted.yml']) assert.ok(browser.includes(name) || name.startsWith('Studio scripted journeys ('), name);
});

test('every absent, non-green, stale-SHA or foreign-suite required check falls back to full qualification', async () => {
  for (const [index, names] of Object.values(REQUIRED_CHECKS).entries()) for (const name of names) {
    for (const change of ['absent', 'failure', 'cancelled', 'skipped', 'neutral', 'pending', 'sha', 'suite', 'duplicate']) {
      const f = fixture(), checks = f.pages.get(`check-suites/${index + 1}/check-runs`).check_runs;
      const check = checks.find(value => value.name === name);
      if (change === 'absent') checks.splice(checks.indexOf(check), 1);
      else if (change === 'duplicate') checks.push({ ...check });
      else if (change === 'sha') check.head_sha = 'b'.repeat(40);
      else if (change === 'suite') check.check_suite = { id: 999 };
      else if (change === 'pending') check.status = 'in_progress';
      else check.conclusion = change;
      assert.equal((await releaseAdmission(input, f)).reuse, false, `${name}: ${change}`);
    }
  }
});

test('only the latest successful main push workflow run can authorize reuse', async () => {
  for (const change of ['missing', 'failure', 'in_progress', 'sha', 'branch', 'event', 'repo', 'suite', 'app', 'newer-failed']) {
    const f = fixture(), runs = f.pages.get('actions/workflows/verify.yml/runs').workflow_runs, run = runs[0];
    if (change === 'missing') runs.length = 0;
    else if (change === 'failure') run.conclusion = 'failure';
    else if (change === 'in_progress') run.status = change;
    else if (change === 'sha') run.head_sha = 'b'.repeat(40);
    else if (change === 'branch') run.head_branch = 'feature';
    else if (change === 'event') run.event = 'pull_request';
    else if (change === 'repo') run.repository.full_name = 'fictional/fork';
    else if (change === 'suite') run.check_suite_id = 999;
    else if (change === 'app') f.pages.get(`commits/${commit}/check-suites`).check_suites[0].app.slug = 'other-app';
    else runs.push({ ...run, id: 999, conclusion: 'failure' });
    assert.equal((await releaseAdmission(input, f)).reuse, false, change);
  }
});

test('a release dispatched while main is still checking its commit waits for that run and reuses it', async () => {
  const f = fixture(), run = f.pages.get('actions/workflows/studio-scripted.yml/runs').workflow_runs[0], fetch = f.fetch;
  let polls = 0;
  Object.assign(run, { status: 'in_progress', conclusion: null });
  f.fetch = async (url, options) => {
    if (url.includes('studio-scripted.yml/runs') && ++polls === 3) Object.assign(run, { status: 'completed', conclusion: 'success' });
    return fetch(url, options);
  };
  assert.deepEqual(await releaseAdmission(input, f), { reuse: true, reason: 'All named verification and browser checks passed on these exact files (main push)' });
  assert.equal(polls, 3);
  assert.equal(f.now(), 60000, 'two 30 s waits');
});

test('pagination is consumed; unavailable or malformed API evidence never authorizes skipping', async () => {
  const f = fixture(), key = `check-suites/1/check-runs`, original = f.pages.get(key);
  f.pages.set(`${key}:1`, { check_runs: Array.from({ length: 100 }, (_, i) => ({ name: `unrelated-${i}` })) });
  f.pages.set(`${key}:2`, original);
  assert.equal((await releaseAdmission(input, f)).reuse, true);
  assert.ok(f.calls.some(url => url.endsWith('page=2')));
  for (const fetch of [async () => new Response('', { status: 403 }), async () => Response.json({}), async () => { throw new Error('fictional outage'); }]) {
    assert.equal((await releaseAdmission(input, { fetch })).reuse, false);
  }
});

test('a mismatched reviewed commit is refused, not a fallback admission', async () => {
  const f = fixture();
  for (const values of [{ commit: 'b'.repeat(40) }, { commit: 'main' }, { repository: 'fictional/fork' }]) await assert.rejects(releaseAdmission({ ...input, ...values }, f), /exact reviewed/);
  assert.equal(f.calls.length, 0);
});

// The fixture's green runs re-labelled as the merged pull request's runs of its head, while main's runs are still going.
function pullRequestEvidence(f, head) {
  for (const [index, workflow] of Object.keys(REQUIRED_CHECKS).entries()) {
    const run = f.pages.get(`actions/workflows/${workflow}/runs`).workflow_runs[0];
    f.pages.set(`actions/workflows/${workflow}/runs?pr`, { workflow_runs: [{ ...run, head_sha: head, head_branch: 'platform/fictional', event: 'pull_request', head_repository: { full_name: repository } }] });
    Object.assign(run, { status: 'in_progress', conclusion: null });
    f.pages.get(`check-suites/${index + 1}/check-runs`).check_runs.forEach(check => { check.head_sha = head; });
  }
  f.pages.get(`commits/${commit}/check-suites`).check_suites.forEach(suite => { suite.head_sha = head; });
  f.pages.set(`commits/${head}/check-suites`, f.pages.get(`commits/${commit}/check-suites`));
  const fetch = f.fetch;
  f.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get('head_sha') === head) return Response.json(f.pages.get(`${parsed.pathname.replace(`/repos/${repository}/`, '')}?pr`));
    if (parsed.pathname.endsWith(`commits/${head}/check-suites`)) return Response.json(f.pages.get(`commits/${head}/check-suites`));
    return fetch(url, options);
  };
}

test('a merge whose files the pull request already tested is admitted at once, without waiting for main', async () => {
  const f = fixture(), head = 'c'.repeat(40);
  pullRequestEvidence(f, head);
  assert.deepEqual(await releaseAdmission({ ...input, tested: head }, f), { reuse: true, reason: 'All named verification and browser checks passed on these exact files (merged pull request)' });
  assert.equal(f.now(), 0, 'no wait');
  // Without a tested head, the same state waits for main and, as main never completes here, falls back.
  const g = fixture(); pullRequestEvidence(g, head);
  assert.equal((await releaseAdmission(input, g)).reuse, false);
});

test('a red or foreign pull request run of the tested head never admits; a completed red main run outranks a green pull request', async () => {
  const head = 'c'.repeat(40);
  for (const change of ['failure', 'fork', 'check', 'main-red']) {
    const f = fixture(); pullRequestEvidence(f, head);
    const pr = f.pages.get('actions/workflows/verify.yml/runs?pr').workflow_runs[0];
    if (change === 'failure') pr.conclusion = 'failure';
    else if (change === 'fork') pr.head_repository = { full_name: 'fictional/fork' };
    else if (change === 'check') f.pages.get('check-suites/1/check-runs').check_runs[0].conclusion = 'failure';
    else Object.assign(f.pages.get('actions/workflows/verify.yml/runs').workflow_runs[0], { status: 'completed', conclusion: 'failure' });
    assert.equal((await releaseAdmission({ ...input, tested: head }, f)).reuse, false, change);
  }
});

test('only an up-to-date merge with an identical tree names its pull request head as already tested', t => {
  const root = mkdtempSync(join(tmpdir(), 'boring-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commitFile = (name, text) => { writeFileSync(join(root, name), text); git('add', '.'); git('commit', '-qm', name); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); commitFile('a.txt', 'fictional base\n');
  git('checkout', '-qb', 'feature'); const head = commitFile('b.txt', 'fictional change\n');
  git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', '-m', 'up to date merge', 'feature');
  assert.equal(testedPullRequestHead(root, git('rev-parse', 'HEAD')), head);
  // main moved after the PR's run: the merge combines files the PR never tested together.
  git('checkout', '-q', 'feature'); const stale = commitFile('c.txt', 'fictional second change\n');
  git('checkout', '-q', 'main'); commitFile('d.txt', 'fictional main change\n');
  git('merge', '-q', '--no-ff', '-m', 'behind merge', 'feature');
  assert.equal(testedPullRequestHead(root, git('rev-parse', 'HEAD')), null);
  assert.equal(testedPullRequestHead(root, head), null, 'a non-merge commit has no tested pull request head');
  assert.ok(stale);
});
