#!/usr/bin/env node
// The improvement loop for one target: a worker (Codex, Sol) edits the kit in a git worktree, the harness captures, Opus judges, repeat.
//   UX_LOOP_HOME=/path nohup node ux/runner/loop.mjs --target layout:bar >> /path/loop.log 2>&1 &      stop: touch $UX_LOOP_HOME/STOP
//   node ux/runner/loop.mjs --target layout:bar --baseline     capture + judge round 0 only        --dry-run   guards + one capture, no model
// State lives OUTSIDE the repo: $UX_LOOP_HOME/<target>/{round-N/<slug>/..., scoreboard.md, STOP}. Never pushes, merges or releases; each round is one commit on the branch.
// Stops when every graded criterion is >= 9, after 10 rounds, after two rounds in a row with no criterion improving, or on STOP.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { root } from './build.mjs';
import { capture, launch } from './capture.mjs';
import { recordFlow } from './video.mjs';
import { judge, KEYS } from './judge.mjs';
import { loadAll, slug } from './scenario.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const DRY = args.includes('--dry-run'), BASELINE = args.includes('--baseline'), MAX_ROUNDS = 10;
const scenario = loadAll().find(s => s.target === opt('target')); if (!scenario) { console.error('usage: loop.mjs --target <layout:bar|component:...> [--baseline|--dry-run]'); process.exit(2); }
const HOME = join(process.env.UX_LOOP_HOME ?? join(homedir(), 'ux-loop'), slug(scenario.target)), S = slug(scenario.target);
const MODEL = process.env.UX_WORKER_MODEL ?? 'gpt-6.1-sol', SKILLS = process.env.UX_SKILLS ?? join(process.env.UX_LOOP_HOME ?? homedir(), 'skills');
const TEST_CMD = process.env.UX_TEST_CMD ?? 'CHROMIUM=$CHROMIUM node --test test/contracts/one-composer.test.mjs';
const PROTECTED = ['docs/tasks/94cd96bf-9124-4082-bc11-7e7925cf9642/acceptance.md', 'test/contracts/one-composer.test.mjs', 'package.json', 'package-lock.json', 'ux/scenarios/', 'ux/runner/', 'ux/CRITERIA.md', 'ux/judge-prompt.md', 'ux/worker-brief.md'];
const MAIN = process.env.UX_MAIN_CHECKOUT; // optional: another checkout the loop must leave untouched
const ENV = { ...process.env, TMPDIR: '/var/tmp', PATH: `${homedir()}/.local/bin:${process.env.PATH}` }; delete ENV.CI;
const log = t => console.log(`${new Date().toISOString()} ${t}`);
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', env: ENV, maxBuffer: 1 << 28, ...o });
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const tail = (t, n = 30) => String(t).split('\n').slice(-n).join('\n');
const roundDir = n => join(HOME, `round-${n}`), folder = n => join(roundDir(n), S);
const readJson = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
const status = d => { if (!d) return ''; try { return execFileSync('git', ['-C', d, 'status', '--porcelain'], { encoding: 'utf8' }); } catch { return ''; } };

function brief(n, prev, feedback) {
  const v = readJson(join(prev, 'verdict.json')), worse = v?.worse?.length ? v.worse.map(w => `${w.what} (${w.where ?? w.screenshot})`).join('; ') : 'nothing reported';
  const map = { N: n, TARGET: scenario.target, TITLE: scenario.title, SCENARIO: scenario.file, NOTES: scenario.notes ?? '', WT: root, BRANCH: git('branch', '--show-current'), TEST_CMD, PREV_DIR: prev, WORSE: worse, HOME, ROUND_DIR: roundDir(n), CAPTURE_MIN: 4, SKILLS, GUARD_FEEDBACK: feedback ? `\n## A guard failed after your first attempt. Fix this, then finish again (amend or add a commit):\n${feedback}\n` : '' };
  return Object.entries(map).reduce((t, [k, val]) => t.replaceAll(`{{${k}}}`, String(val)), readFileSync(join(root, 'ux/worker-brief.md'), 'utf8'));
}
function worker(n, prev, feedback, tag) {
  mkdirSync(roundDir(n), { recursive: true });
  const file = join(roundDir(n), `worker-brief${tag}.md`); writeFileSync(file, brief(n, prev, feedback));
  if (DRY) return log(`dry run: worker skipped (brief in ${file})`);
  log(`worker: codex exec ${MODEL} (round ${n}${tag})`);
  const out = sh('codex', ['exec', '-m', MODEL, '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"', '-s', 'workspace-write', '--add-dir', roundDir(n), '-C', root, '--ephemeral', '-o', join(roundDir(n), `worker-last${tag}.txt`), '-'], { input: readFileSync(file, 'utf8'), timeout: 90 * 60 * 1000 });
  writeFileSync(join(roundDir(n), `worker${tag}.log`), `${out.stdout}\n${out.stderr}`); log(`worker exit ${out.status}`);
}

// Guards: a commit, a clean tree, the harness and the contract untouched, nothing changed in the main checkout, tests and checks green.
function guards(before, mainBefore) {
  const fails = [];
  if (git('rev-parse', 'HEAD') === before) fails.push('no commit: the round must end with one commit on the branch.');
  if (git('status', '--porcelain')) fails.push(`uncommitted changes remain:\n${git('status', '--porcelain')}`);
  const touched = git('diff', '--name-only', `${before}..HEAD`).split('\n').filter(f => f && PROTECTED.some(p => f === p || (p.endsWith('/') && f.startsWith(p))));
  if (touched.length) fails.push(`protected files changed (contract, harness, dependencies): ${touched.join(', ')}`);
  if (status(MAIN) !== mainBefore) fails.push('the main checkout changed; it must never be touched.');
  const test = sh('bash', ['-c', TEST_CMD], { cwd: root, timeout: 30 * 60 * 1000 }); if (test.status !== 0) fails.push(`${TEST_CMD} failed:\n${tail(test.stdout + test.stderr)}`);
  const chk = sh('npm', ['run', 'check'], { cwd: root, timeout: 30 * 60 * 1000 }); if (chk.status !== 0) fails.push(`npm run check failed:\n${tail(chk.stdout + chk.stderr)}`);
  return fails;
}
// The flow guard: a step that completed in the last good round and no longer does fails the round; so does a new console error.
async function flowGuard(n, prevResult) {
  const { result } = await capture(scenario, roundDir(n));
  const fails = [], was = new Map((prevResult?.flows ?? []).flatMap(f => f.steps.map((s, i) => [`${f.id}@${f.viewport}#${i}`, s.ok])));
  for (const f of result.flows) f.steps.forEach((s, i) => { if (!s.ok && !s.gap && was.get(`${f.id}@${f.viewport}#${i}`)) fails.push(`flow step no longer completes: ${f.id}@${f.viewport} step ${i + 1} "${s.say}"`); });
  const before = new Set(prevResult?.errors ?? []); for (const e of result.errors) if (!before.has(e)) fails.push(`new console error: ${e}`);
  return { fails, result };
}
function score(n, v, p, commit, note = '') {
  const cells = KEYS.map(k => v?.grades?.[k] ?? '-'), nums = cells.filter(x => typeof x === 'number');
  const up = v && p ? KEYS.filter(k => v.grades[k] > (p.grades[k] ?? 0)).join(', ') || 'none' : '-', down = v && p ? KEYS.filter(k => v.grades[k] < (p.grades[k] ?? 0)).join(', ') || 'none' : '-';
  const file = join(HOME, DRY ? 'scoreboard.dry.md' : 'scoreboard.md'); mkdirSync(HOME, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `| round | ${KEYS.join(' | ')} | lowest | improved | worse | commit |\n|${'---|'.repeat(KEYS.length + 5)}\n`);
  appendFileSync(file, `| ${n} | ${cells.join(' | ')} | ${nums.length ? Math.min(...nums) : '-'} | ${up} | ${down} | ${commit}${note ? ' ' + note : ''} |\n`);
}
const done = v => KEYS.every(k => v.grades[k] === undefined || v.grades[k] >= 9);

mkdirSync(HOME, { recursive: true });
if (BASELINE) { // round 0: capture (with videos if --video) and judge; --capture-only / --judge-only split the two (judges can run side by side)
  if (!args.includes('--judge-only')) {
    const { out } = await capture(scenario, roundDir(0));
    if (args.includes('--video')) { const browser = await launch(); for (const f of scenario.flows) for (const vp of scenario.viewports) if (!f.only || String(f.only) === vp.name) await recordFlow({ scenario, flowId: f.id, viewport: vp.name, outDir: join(out, 'videos'), browser }); await browser.close(); }
    writeFileSync(join(out, 'target.json'), JSON.stringify({ target: scenario.target, title: scenario.title, purpose: scenario.purpose, level: scenario.target.split(':')[0], kitVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, commit: git('rev-parse', '--short', 'HEAD'), capturedAt: new Date().toISOString() }, null, 1));
  }
  if (args.includes('--capture-only')) process.exit(0);
  const v = judge({ folder: folder(0), scenario, round: 0 }); if (!v) { log('baseline: no usable verdict'); process.exit(1); }
  score(0, v, null, git('rev-parse', '--short', 'HEAD'), '(baseline)'); log(`baseline ${JSON.stringify(v.grades)}`); process.exit(0);
}
let n = 1; while (existsSync(join(folder(n), 'verdict.json'))) n++;
let prev = folder(n - 1), prevVerdict = readJson(join(prev, 'verdict.json')), prevResult = readJson(join(prev, 'result.json')), idle = 0;
if (!prevVerdict && !DRY) { log('no round-0 verdict: run --baseline first'); process.exit(1); }
log(`start ${scenario.target} at round ${n}${DRY ? ' (dry run)' : ''}, branch ${git('branch', '--show-current')}`);
for (; n <= MAX_ROUNDS; n++) {
  if (existsSync(join(HOME, 'STOP'))) { log('STOP file found'); break; }
  if (prevVerdict && done(prevVerdict)) { log('every criterion is at 9 or more: done'); break; }
  const before = git('rev-parse', 'HEAD'), mainBefore = status(MAIN);
  worker(n, prev, '', '');
  // Chromium cannot start inside Codex's workspace-write sandbox (crashpad/sandbox-host syscalls are refused), so the worker cannot look at its own result: the loop captures it and gives it back for a second pass.
  if (!DRY && process.env.UX_SELF_PASS !== '0' && git('rev-parse', 'HEAD') !== before) {
    const self = join(roundDir(n), 'self'); await capture(scenario, self);
    worker(n, prev, `SELF-CHECK. The loop captured your first pass into ${join(self, S)} (states, flow strips, metrics.json, same layout as ${prev}). Open it, compare with the judge's problems, and fix what is still visibly wrong or measurably worse than before; amend your commit (one commit per round). Your sandbox cannot start a browser, so this capture is your only look at the result.`, '-self');
  }
  let fails = guards(before, mainBefore), shot;
  if (!fails.length || DRY) { shot = await flowGuard(n, prevResult); fails = fails.concat(shot.fails); }
  if (fails.length && !DRY) {
    log(`guard failed, one retry:\n${tail(fails.join('\n'))}`);
    worker(n, prev, fails.join('\n\n').slice(-6000), '-retry');
    fails = guards(before, mainBefore); if (!fails.length) { shot = await flowGuard(n, prevResult); fails = shot.fails; }
  }
  if (fails.length) {
    log(`round ${n} FAILED:\n${tail(fails.join('\n'))}`);
    if (!DRY) { git('reset', '--hard', before); log(`reverted to ${before.slice(0, 9)}`); }
    score(n, null, null, '-', `FAILED: ${fails[0].split('\n')[0]}`); idle++;
    if (DRY) break;
  } else {
    const commit = git('rev-parse', '--short', 'HEAD');
    const v = DRY ? null : judge({ folder: folder(n), scenario, round: n, prev });
    if (!v) { log('judge gave no usable verdict'); score(n, null, null, commit, 'judge failed'); break; }
    score(n, v, prevVerdict, commit);
    idle = KEYS.some(k => v.grades[k] > (prevVerdict.grades[k] ?? 0)) ? 0 : idle + 1;
    log(`round ${n} grades ${JSON.stringify(v.grades)}`); prev = folder(n); prevVerdict = v; prevResult = shot.result;
  }
  if (DRY) break;
  if (idle >= 2) { log('two rounds in a row with no criterion improving: stopping'); break; }
}
log('loop ended');
