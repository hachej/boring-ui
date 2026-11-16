// The git and round mechanics of the UX loop, with no model, browser or network in them, so a test can drive them with a fake worker.
// The worker only edits files. The loop commits for it, discards what failed, and refuses edits to the exam.
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { loadavg } from 'node:os';

export const FORBIDDEN = ['docs/tasks/94cd96bf-9124-4082-bc11-7e7925cf9642/acceptance.md', 'test/contracts/', 'package.json', 'package-lock.json', 'ux/scenarios/', 'ux/runner/', 'ux/CRITERIA.md', 'ux/judge-prompt.md', 'ux/worker-brief.md'];
const matches = (f, list) => list.some(p => f === p || (p.endsWith('/') && f.startsWith(p)));
export const forbiddenTouched = (files, list = FORBIDDEN) => files.filter(f => matches(f, list));

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\n$/, '');

// Every path that differs from HEAD or is new, the renames' both sides included.
export function changedFiles(cwd) {
  const parts = git(cwd, 'status', '--porcelain', '-uall', '-z').split('\0').filter(Boolean), out = [];
  for (let i = 0; i < parts.length; i++) { const code = parts[i].slice(0, 2); out.push(parts[i].slice(3)); if (code[0] === 'R' || code[0] === 'C') out.push(parts[++i]); }
  return [...new Set(out)].sort();
}

// Put the tree back to `sha`: no `git reset --hard`, no stash. Files the round added are removed, inside the worktree only.
export function discard(cwd, sha) {
  const added = new Set([...git(cwd, 'ls-files', '--others', '--exclude-standard').split('\n'), ...git(cwd, 'diff', '--name-only', '--diff-filter=A', sha).split('\n')].filter(Boolean));
  for (const f of added) {
    const abs = resolve(cwd, f); if (!abs.startsWith(resolve(cwd) + sep)) continue;
    try { git(cwd, 'rm', '-q', '-f', '--cached', '--ignore-unmatch', '--', f); } catch { /* untracked */ }
    rmSync(abs, { force: true });
  }
  git(cwd, 'checkout', sha, '--', '.');
}

// One commit on behalf of the worker; null when there is nothing to commit.
export function commitRound({ cwd, n, target, model, body = '' }) {
  git(cwd, 'add', '-A');
  if (!git(cwd, 'diff', '--cached', '--name-only')) return null;
  const files = git(cwd, 'diff', '--cached', '--name-only').split('\n').length;
  git(cwd, '-c', 'user.name=UX loop', '-c', 'user.email=ux-loop@boring.local', 'commit', '-q', `--author=${model} (UX loop round ${n}) <ux-loop@boring.local>`, '-m', `UX round ${n} (${target}): ${files} file${files === 1 ? '' : 's'} edited by ${model}\n\n${body.slice(0, 3000)}`);
  return git(cwd, 'rev-parse', '--short', 'HEAD');
}

// The failing tests of a TAP run with their assertion, file and line, so a worker can repair one without reading a whole log.
export function failingTests(tap) {
  const lines = String(tap).split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*not ok \d+ - /.test(lines[i])) continue;
    const block = [lines[i]]; let j = i + 1;
    while (j < lines.length && /^\s+/.test(lines[j]) && !/^\s*(not )?ok \d+ - /.test(lines[j])) block.push(lines[j++]);
    out.push(block.join('\n'));
  }
  return out;
}

// Work, refuse, check, then up to `repairs` repair passes, each given the precise failure of the one before; leaves the accepted edits
// uncommitted (the caller judges, then commits or discards). runWorker({ feedback, tag }) edits files. refuse(changed) -> reasons (the exam
// touched, too many files): no repair, the round is discarded. runChecks(changed) -> [{ name, output }]. save(name, text) writes into the round folder.
export async function runRound({ cwd, runWorker, refuse = () => [], runChecks, save = () => {}, log = () => {}, repairs = 3 }) {
  const start = git(cwd, 'rev-parse', 'HEAD');
  if (changedFiles(cwd).length) discard(cwd, start);
  const fail = reason => { discard(cwd, start); return { status: 'failed', reason, start }; };
  await runWorker({ feedback: '', tag: '' });
  let changed = changedFiles(cwd);
  if (!changed.length) return { status: 'no-change', start };
  const refused = () => refuse(changed);
  let bad = refused(); if (bad.length) { save('refused.txt', bad.join('\n')); return fail(`refused: ${bad[0]}`); }
  let failures = await runChecks(changed);
  for (let attempt = 1; failures.length; attempt++) {
    const text = failures.map(f => `## ${f.name}\n${f.output}`).join('\n\n');
    save(`failure-${attempt}.txt`, text);
    if (attempt > repairs) return fail(`${failures[0].name} still failing after ${repairs === 1 ? 'one repair' : `${repairs} repairs`}`);
    log(`round failed its checks (${failures.map(f => f.name).join(', ')}); repair ${attempt} of ${repairs}:\n${text.slice(-3000)}`);
    await runWorker({ feedback: text.slice(-12000), tag: attempt === 1 ? '-repair' : `-repair-${attempt}` });
    changed = changedFiles(cwd);
    if (!changed.length) return fail('repair undid every edit');
    bad = refused(); if (bad.length) { save('refused.txt', bad.join('\n')); return fail(`refused after repair: ${bad[0]}`); }
    failures = await runChecks(changed);
  }
  return { status: 'ready', start, changed };
}

// The real error of a failed check: warnings, passing "ok" lines, npm's banner and blank lines stripped, so what is left is what failed.
export const errorText = (out, max = 80) => String(out).split('\n').filter(l => l.trim() && !/^(WARN |ok:|> |verify:repo (passed|emitted)|Scope: |\(full output)/.test(l)).slice(0, max).join('\n');
// The steps of `npm run check` (a chain of `node scripts/x.mjs`) so each can run alone and name itself; null when the script is not such a chain.
export function checkSteps(script) {
  const steps = String(script ?? '').split(/\s*&&\s*/).filter(Boolean);
  return steps.length && steps.every(s => /^node scripts\/[\w.-]+\.mjs$/.test(s)) ? steps : null;
}
// A step whose normal output hides the offenders is run with the flag that lists them.
export const detailed = step => /check-design\.mjs$/.test(step) ? `${step} --details` : step;

// Wait (bounded) until the 1-minute load average is under `max`; returns how long it waited.
export async function waitForLoad({ max = 25, timeoutMs = 5 * 60 * 1000, load = () => loadavg()[1], sleep = ms => new Promise(r => setTimeout(r, ms)), step = 15000, log = () => {} } = {}) {
  let waited = 0;
  while (load() >= max && waited < timeoutMs) { if (waited === 0) log(`load ${load().toFixed(1)} >= ${max}: waiting before the capture (up to ${timeoutMs / 60000} min)`); await sleep(step); waited += step; }
  if (waited >= timeoutMs) log(`load still ${load().toFixed(1)} after ${waited / 60000} min: capturing anyway`);
  return waited;
}

// A capture that crashes is retried once; a crash is not a failed round.
export async function retried(fn, { log = () => {}, label = 'capture' } = {}) {
  try { return await fn(); } catch (e) { log(`${label} crashed (${String(e.message).split('\n')[0]}); retrying once`); return await fn(); }
}

// A noisy number is the median of 3: a layout-shift line stays only when at least 2 of 3 runs show it (the first run's text is kept).
export const shiftKey = l => l.replace(/(": )(.*)$/s, (_, a, b) => a + b.replace(/[\d.]+/g, '#'));
export function medianShiftLines(first, others) {
  const sets = others.map(o => new Set(o.filter(l => / layout shift /.test(l)).map(shiftKey)));
  return first.filter(l => !/ layout shift /.test(l) || sets.filter(s => s.has(shiftKey(l))).length >= 1);
}
export const incomplete = lines => lines.filter(l => /did not complete/.test(l));

export function saveTo(dir) { return (name, text) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), text); }; }
