import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CHECKS = {
  'verify.yml': ['Specification checks', 'tests', 'release-gate', 'Public demo Worker bundle',
    ...['documents', 'native', 'canvas', 'composition'].map(kind => `Isolated package consumers (${kind})`),
    'Isolated package consumers', 'verify'],
  'studio-scripted.yml': [...['studio-1', 'studio-2', 'design', 'workspace', 'documents'].map(shard => `Studio scripted journeys (${shard})`), 'Studio scripted journeys'],
};

export async function releaseAdmission({ commit, sha, repository, token }, { fetch: request = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, waitIntervalMs = 30000, waitTimeoutMs = 1200000 } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || commit !== sha || repository !== 'hachej/boring-ui') throw new Error('Publication must use the exact reviewed dispatch commit in hachej/boring-ui');
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
  try {
    const deadline = now() + waitTimeoutMs;
    for (const [workflow, names] of Object.entries(REQUIRED_CHECKS)) {
      // A release dispatched right after its merge waits for main's own run of this commit rather than repeating it.
      let run;
      for (;;) {
        const runs = await list(`actions/workflows/${workflow}/runs?head_sha=${commit}`, 'workflow_runs');
        run = runs.filter(value => value.head_sha === commit && value.head_branch === 'main' && value.event === 'push' && value.repository?.full_name === repository).sort((a, b) => b.id - a.id)[0];
        if (run?.status === 'completed' || now() >= deadline) break;
        await sleep(waitIntervalMs);
      }
      if (!run || run.status !== 'completed' || run.conclusion !== 'success') return fallback(`${workflow}: latest exact-SHA main push run is not green`);
      const suites = await list(`commits/${commit}/check-suites`, 'check_suites');
      const suite = suites.find(value => value.id === run.check_suite_id && value.head_sha === commit && value.app?.slug === 'github-actions');
      if (!suite) return fallback(`${workflow}: missing GitHub Actions suite for this SHA`);
      const checks = await list(`check-suites/${suite.id}/check-runs?filter=latest`, 'check_runs');
      for (const name of names) {
        const matches = checks.filter(value => value.name === name);
        if (matches.length !== 1 || matches[0].head_sha !== commit || matches[0].check_suite?.id !== suite.id || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') return fallback(`${workflow}: required check not green: ${name}`);
      }
    }
    return { reuse: true, reason: 'All named verification and browser checks passed on this exact main push SHA' };
  } catch { return fallback('GitHub check evidence unavailable; run full qualification'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await releaseAdmission({ commit: process.env.REVIEWED_COMMIT, sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
  console.log(JSON.stringify(result));
  appendFileSync(process.env.GITHUB_OUTPUT, `reuse-ci=${result.reuse}\n`);
}
