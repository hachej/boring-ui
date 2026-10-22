import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';

export const REQUIRED_CHECKS = {
  'verify.yml': ['Specification checks', 'tests', 'release-gate', 'Public demo Worker bundle',
    ...['documents', 'native', 'canvas', 'composition'].map(kind => `Isolated package consumers (${kind})`),
    'Isolated package consumers', 'verify'],
  'studio-scripted.yml': [...['studio-1', 'studio-2', 'design', 'workspace', 'documents'].map(shard => `Studio scripted journeys (${shard})`), 'Studio scripted journeys'],
};

// The merged pull request head whose own CI tested exactly this commit's files, or null. A merge commit qualifies when its
// main parent is already inside the head (the head was up to date) and the trees match: the PR's test merge was this tree.
export function testedPullRequestHead(root, commit) {
  const git = args => runCaptured('git', args, { cwd: root });
  const parents = git(['rev-list', '--parents', '-n', '1', commit]);
  const [, main, head, extra] = parents.status === 0 ? parents.stdout.trim().split(' ') : [];
  if (!head || extra || git(['merge-base', '--is-ancestor', main, head]).status !== 0) return null;
  const tree = sha => git(['rev-parse', `${sha}^{tree}`]).stdout.trim();
  return tree(commit) && tree(commit) === tree(head) ? head : null;
}

export async function releaseAdmission({ commit, sha, repository, token, tested = null }, { fetch: request = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, waitIntervalMs = 30000, waitTimeoutMs = 1200000 } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || commit !== sha || repository !== 'hachej/boring-ui') throw new Error('Publication must use the exact reviewed dispatch commit in hachej/boring-ui');
  if (tested !== null && !/^[a-f0-9]{40}$/.test(tested)) throw new Error('A tested pull request head must be an exact SHA');
  const fallback = reason => ({ reuse: false, reason });
  const list = async (path, key) => {
    const values = [];
    for (let page = 1; page <= 20; page++) {
      const response = await request(`https://api.github.com/repos/${repository}/${path}${path.includes('?') ? '&' : '?'}per_page=100${page === 1 ? '' : `&page=${page}`}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('GitHub check evidence unavailable');
      const data = await response.json();
      if (!Array.isArray(data[key])) throw new Error('Invalid GitHub check evidence');
      values.push(...data[key]);
      if (data[key].length < 100) return values;
    }
    throw new Error('GitHub check evidence exceeds pagination limit');
  };
  const latest = async (workflow, head, event) => (await list(`actions/workflows/${workflow}/runs?head_sha=${head}`, 'workflow_runs'))
    .filter(value => value.head_sha === head && value.event === event && value.repository?.full_name === repository
      && (event === 'push' ? value.head_branch === 'main' : value.head_repository?.full_name === repository))
    .sort((a, b) => b.id - a.id)[0];
  // Every named check of this run is the latest, green, and belongs to its GitHub Actions suite on that head.
  const failing = async (run, head, names) => {
    if (!run || run.status !== 'completed' || run.conclusion !== 'success') return 'run is not green';
    const suites = await list(`commits/${head}/check-suites`, 'check_suites');
    const suite = suites.find(value => value.id === run.check_suite_id && value.head_sha === head && value.app?.slug === 'github-actions');
    if (!suite) return 'missing GitHub Actions suite for this SHA';
    const checks = await list(`check-suites/${suite.id}/check-runs?filter=latest`, 'check_runs');
    for (const name of names) {
      const matches = checks.filter(value => value.name === name);
      if (matches.length !== 1 || matches[0].head_sha !== head || matches[0].check_suite?.id !== suite.id || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') return `required check not green: ${name}`;
    }
    return null;
  };
  try {
    const deadline = now() + waitTimeoutMs, sources = new Set();
    for (const [workflow, names] of Object.entries(REQUIRED_CHECKS)) {
      // Main's own completed run decides. Until it completes, the merged PR's green run of the same files suffices;
      // otherwise wait for main rather than repeating its run.
      let problem;
      for (;;) {
        const main = await latest(workflow, commit, 'push');
        if (main?.status === 'completed') { problem = await failing(main, commit, names); sources.add('main push'); break; }
        if (tested && !(await failing(await latest(workflow, tested, 'pull_request'), tested, names))) { problem = null; sources.add('merged pull request'); break; }
        if (now() >= deadline) { problem = 'latest exact-SHA main push run is not green'; break; }
        await sleep(waitIntervalMs);
      }
      if (problem) return fallback(`${workflow}: ${problem}`);
    }
    return { reuse: true, reason: `All named verification and browser checks passed on these exact files (${[...sources].join(', ')})` };
  } catch { return fallback('GitHub check evidence unavailable; run full qualification'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url)), commit = process.env.REVIEWED_COMMIT;
  const tested = /^[a-f0-9]{40}$/.test(commit ?? '') ? testedPullRequestHead(root, commit) : null;
  const result = await releaseAdmission({ commit, sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN, tested });
  console.log(JSON.stringify(result));
  appendFileSync(process.env.GITHUB_OUTPUT, `reuse-ci=${result.reuse}\n`);
}
