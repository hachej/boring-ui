#!/usr/bin/env node
// The improvement loop for one target: a worker (Codex, Sol) edits the kit in a git worktree, the harness captures, Opus judges, repeat.
//   UX_LOOP_HOME=/path nohup node ux/runner/loop.mjs --target layout:bar >> /path/loop.log 2>&1 &      stop: touch $UX_LOOP_HOME/<target-slug>/STOP
//   node ux/runner/loop.mjs --target layout:bar --baseline     capture + judge round 0 only        --dry-run   brief + one capture, no model
// State lives OUTSIDE the repo: $UX_LOOP_HOME/<target>/{round-N/<slug>/..., scoreboard.md, STOP}. Never pushes, merges or releases.
// The worker (sandboxed) only EDITS FILES. The loop does the rest: registry build, npm run check, the contract tests, the harness check and capture
// (one repair pass with the full failing output), the judge; then it commits the round for the worker, or discards the edits (files checked out to the
// round's start commit; no reset --hard, no stash) when a check, the exam guard or a regression says so. See loop-round.mjs and ux/README.md.
// Stops when every graded criterion is >= 9, after UX_MAX_ROUNDS (10) rounds, after UX_MAX_IDLE (3) rounds in a row that improved nothing, or on STOP (read between rounds).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { root } from './build.mjs';
import { capture, launch } from './capture.mjs';
import { check } from './check.mjs';
import { recordFlow } from './video.mjs';
import { judge, KEYS } from './judge.mjs';
import { commitRound, discard, failingTests, forbiddenTouched, incomplete, medianShiftLines, retried, runRound, saveTo, shiftKey, waitForLoad } from './loop-round.mjs';
import { loadAll, slug } from './scenario.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const DRY = args.includes('--dry-run'), BASELINE = args.includes('--baseline');
const MAX_ROUNDS = Number(process.env.UX_MAX_ROUNDS ?? 10), MAX_IDLE = Number(process.env.UX_MAX_IDLE ?? 3), LOAD_MAX = Number(process.env.UX_LOAD_MAX ?? 40);
const scenario = loadAll().find(s => s.target === opt('target')); if (!scenario) { console.error('usage: loop.mjs --target <layout:bar|component:...> [--baseline|--dry-run]'); process.exit(2); }
const HOME = join(process.env.UX_LOOP_HOME ?? join(homedir(), 'ux-loop'), slug(scenario.target)), S = slug(scenario.target);
const MODEL = process.env.UX_WORKER_MODEL ?? 'gpt-6.1-sol', SKILLS = process.env.UX_SKILLS ?? join(process.env.UX_LOOP_HOME ?? homedir(), 'skills');
const TEST_CMD = process.env.UX_TEST_CMD ?? 'CHROMIUM=$CHROMIUM node --test --test-reporter=tap test/contracts/one-composer.test.mjs test/contracts/agent-bar.test.mjs';
const MAIN = process.env.UX_MAIN_CHECKOUT; // optional: another checkout the loop must leave untouched
const ENV = { ...process.env, TMPDIR: '/var/tmp', PATH: `${homedir()}/.local/bin:${process.env.PATH}` }; delete ENV.CI;
const log = t => console.log(`${new Date().toISOString()} ${t}`);
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', env: ENV, maxBuffer: 1 << 28, ...o });
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const tail = (t, n = 30) => String(t).split('\n').slice(-n).join('\n');
const roundDir = n => join(HOME, `round-${n}`), folder = n => join(roundDir(n), S);
const readJson = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
const status = d => { if (!d) return ''; try { return execFileSync('git', ['-C', d, 'status', '--porcelain'], { encoding: 'utf8' }); } catch { return ''; } };
const lowest = v => Math.min(...KEYS.map(k => v?.grades?.[k]).filter(x => typeof x === 'number'));
const FAILING = join(HOME, 'last-failure.txt'), LINES = join(HOME, 'check-lines.json');
// `layout:bar F01@1440 step 3 "Tap": layout shift 0.095 > 0.08` keyed with the numbers after the step name blanked: a metric moving is not a new problem.
const lineKey = shiftKey;

// The worker gets eyes: the last accepted capture (pictures, per-step metrics, check lines, the judge's remarks) copied next to its brief, in a folder its sandbox can read.
function eyes(n, prev, lines) {
  const dir = join(roundDir(n), 'eyes'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  if (existsSync(prev)) cpSync(prev, join(dir, 'capture', S), { recursive: true, filter: p => !/\/videos(\/|$)/.test(p) && !/\.(webm|mp4)$/.test(p) });
  writeFileSync(join(dir, 'check-lines.txt'), lines.length ? `${lines.length} failing check lines (the loop must not make this worse):\n${lines.join('\n')}\n` : 'no failing check lines\n');
  if (existsSync(FAILING)) cpSync(FAILING, join(dir, 'last-failure.txt'));
  return dir;
}
function brief(n, prev, feedback, eyesDir) {
  const v = readJson(join(prev, 'verdict.json')), worse = v?.worse?.length ? v.worse.map(w => `${w.what} (${w.where ?? w.screenshot})`).join('; ') : 'nothing reported';
  const map = { N: n, TARGET: scenario.target, TITLE: scenario.title, SCENARIO: scenario.file, NOTES: scenario.notes ?? '', WT: root, BRANCH: git('branch', '--show-current'), TEST_CMD, EYES: eyesDir, PREV_DIR: join(eyesDir, 'capture', S), WORSE: worse, HOME, ROUND_DIR: roundDir(n), SKILLS, FEEDBACK: feedback ? `\n## What the loop found after your last pass (full output in ${roundDir(n)}). Fix exactly this; edit files only:\n${feedback}\n` : '' };
  return Object.entries(map).reduce((t, [k, val]) => t.replaceAll(`{{${k}}}`, String(val)), readFileSync(join(root, 'ux/worker-brief.md'), 'utf8'));
}
function worker(n, prev, lines, feedback, tag) {
  mkdirSync(roundDir(n), { recursive: true });
  const file = join(roundDir(n), `worker-brief${tag}.md`); writeFileSync(file, brief(n, prev, feedback, eyes(n, prev, lines)));
  if (DRY) return log(`dry run: worker skipped (brief in ${file})`);
  log(`worker: codex exec ${MODEL} (round ${n}${tag})`);
  const out = sh('codex', ['exec', '-m', MODEL, '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"', '-s', 'workspace-write', '--add-dir', roundDir(n), '-C', root, '--ephemeral', '-o', join(roundDir(n), `worker-last${tag}.txt`), '-'], { input: readFileSync(file, 'utf8'), timeout: 90 * 60 * 1000 });
  writeFileSync(join(roundDir(n), `worker${tag}.log`), `${out.stdout}\n${out.stderr}`); log(`worker exit ${out.status}${out.status ? `: ${tail(out.stderr, 6)}` : ''}`);
}

// The checks the sandbox cannot run, cheapest first; every failure carries its full output (test name, assertion, file and line).
async function loopChecks(n, changed, ctx) {
  const dir = roundDir(n), fails = [], pass = (ctx.pass = (ctx.pass ?? 0) + 1), save = saveTo(dir);
  const run = (name, cmd, cmdArgs, tap) => {
    const r = sh(cmd, cmdArgs, { cwd: root, timeout: 30 * 60 * 1000 }), out = `${r.stdout}\n${r.stderr}`, file = join(dir, `${name.replace(/\W+/g, '-')}-${pass}.txt`);
    save(file.slice(dir.length + 1), out); log(`${name}: exit ${r.status}`);
    if (r.status === 0) return;
    const found = tap ? failingTests(out) : [];
    fails.push({ name, output: found.length ? `${found.join('\n---\n')}\n(full output: ${file})` : `${tail(out, 120)}\n(full output: ${file})` });
  };
  if (changed.some(f => f === 'registry.json' || f.startsWith('registry/'))) run('npm run registry:build', 'npm', ['run', 'registry:build']);
  run('npm run check', 'npm', ['run', 'check']);
  run('contract tests', 'bash', ['-c', TEST_CMD], true);
  if (fails.length) return fails;
  await waitForLoad({ max: LOAD_MAX, log });
  const { result: fast } = await retried(() => capture(scenario, join(dir, '_check'), { fast: true }), { log, label: 'check capture' });
  ctx.lines = check(scenario, fast);
  if (ctx.lines.some(l => / layout shift /.test(l))) { // layout shift is noisy under load: a shift stays only when 2 of 3 captures show it
    const more = [];
    for (let i = 0; i < 2; i++) { await waitForLoad({ max: LOAD_MAX, log }); more.push(check(scenario, (await retried(() => capture(scenario, join(dir, '_check'), { fast: true }), { log, label: 'check capture' })).result)); }
    ctx.lines = medianShiftLines(ctx.lines, more);
  }
  rmSync(join(dir, '_check'), { recursive: true, force: true }); save(`check-lines-${pass}.txt`, ctx.lines.join('\n'));
  const seen = new Set(ctx.prevLines.map(lineKey)), fresh = ctx.lines.filter(l => !seen.has(lineKey(l)));
  log(`harness check: ${ctx.lines.length} failing lines (was ${ctx.prevLines.length}), ${fresh.length} not seen before; ${incomplete(ctx.lines).length} steps did not complete (was ${incomplete(ctx.prevLines).length})`);
  if (incomplete(ctx.lines).length > incomplete(ctx.prevLines).length) fails.push({ name: 'a step that completed before no longer completes', output: `${incomplete(ctx.lines).length} "did not complete" lines, was ${incomplete(ctx.prevLines).length}:\n${incomplete(ctx.lines).join('\n')}` });
  if (fails.length) return fails;
  await waitForLoad({ max: LOAD_MAX, log });
  ctx.shot = await retried(() => flowGuard(n, ctx.prevResult), { log, label: 'capture' });
  if (ctx.shot.fails.length) fails.push({ name: 'flow guard', output: ctx.shot.fails.join('\n') });
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
// Scoreboard: per round the commit, the criteria, the failing check lines, and why a round failed, was reverted or changed nothing.
function score(n, { v, p, commit = '-', checks = '-', note = '' }) {
  const cells = KEYS.map(k => v?.grades?.[k] ?? '-'), nums = cells.filter(x => typeof x === 'number');
  const up = v && p ? KEYS.filter(k => v.grades[k] > (p.grades[k] ?? 0)).join(', ') || 'none' : '-', down = v && p ? KEYS.filter(k => v.grades[k] < (p.grades[k] ?? 0)).join(', ') || 'none' : '-';
  const file = join(HOME, DRY ? 'scoreboard.dry.md' : 'scoreboard.md'); mkdirSync(HOME, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `| round | ${KEYS.join(' | ')} | lowest | improved | worse | failing check lines | commit | result |\n|${'---|'.repeat(KEYS.length + 6)}\n`);
  appendFileSync(file, `| ${n} | ${cells.join(' | ')} | ${nums.length ? Math.min(...nums) : '-'} | ${up} | ${down} | ${checks ?? '-'} | ${commit} | ${note.replace(/\s+/g, ' ').slice(0, 300)} |\n`);
}
// Handed to the judge: the loop vetoes only on the fast checks, the contract tests, a step that stopped completing and the exam; the rest is evidence.
const evidence = (lines, before) => `Failing check lines now: ${lines.length} (accepted round before: ${before.length}). Steps that do not complete now: ${incomplete(lines).length} (before: ${incomplete(before).length}).\n${lines.length ? lines.join('\n') : 'none'}\n`;
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
  score(0, { v, commit: git('rev-parse', '--short', 'HEAD'), note: '(baseline)' }); log(`baseline ${JSON.stringify(v.grades)}`); process.exit(0);
}
let n = 1; while (existsSync(join(folder(n), 'verdict.json'))) n++;
let lastWhy = '', sameWhy = 0, prev = folder(n - 1), prevVerdict = readJson(join(prev, 'verdict.json')), prevResult = readJson(join(prev, 'result.json')), idle = 0;
const baselineText = join(HOME, 'baseline-after-port.txt');
let prevLines = readJson(LINES) ?? (existsSync(baselineText) ? readFileSync(baselineText, 'utf8').split('\n').filter(l => /^\s{2,}\S/.test(l)).map(l => l.trim()) : []);
if (!prevVerdict && !DRY) { log('no round-0 verdict: run --baseline first'); process.exit(1); }
log(`start ${scenario.target} at round ${n}${DRY ? ' (dry run)' : ''}, branch ${git('branch', '--show-current')}, ${prevLines.length} failing check lines to start from`);
for (; n <= MAX_ROUNDS; n++) {
  if (existsSync(join(HOME, 'STOP'))) { log('STOP file found'); break; }
  if (prevVerdict && done(prevVerdict)) { log('every criterion is at 9 or more: done'); break; }
  const mainBefore = status(MAIN), ctx = { prevLines, prevResult };
  if (DRY) { worker(n, prev, prevLines, '', ''); await waitForLoad({ max: LOAD_MAX, log }); const s = await retried(() => capture(scenario, roundDir(n)), { log }); log(`dry run: ${check(scenario, s.result).length} check lines`); break; }
  const rec = await runRound({
    cwd: root, save: saveTo(roundDir(n)), log,
    runWorker: ({ feedback, tag }) => worker(n, prev, prevLines, feedback, tag),
    refuse: changed => [...forbiddenTouched(changed).map(f => `the worker changed ${f}: the harness, the contract and the rubric are not the worker's to edit`), ...(status(MAIN) !== mainBefore ? ['the main checkout changed; it must never be touched.'] : [])],
    runChecks: changed => loopChecks(n, changed, ctx),
  });
  if (rec.status === 'no-change') { log(`round ${n}: no change (the worker edited nothing)`); score(n, { note: 'no change: the worker edited nothing' }); idle++; }
  else if (rec.status === 'failed') {
    log(`round ${n} FAILED, edits discarded (back at ${rec.start.slice(0, 9)}): ${rec.reason}`);
    writeFileSync(FAILING, `Round ${n} was discarded: ${rec.reason}\n${['failure-2.txt', 'failure-1.txt', 'refused.txt'].map(f => join(roundDir(n), f)).filter(existsSync).map(f => readFileSync(f, 'utf8')).join('\n').slice(-6000)}\n`);
    score(n, { checks: ctx.lines?.length, note: `FAILED: ${rec.reason}` }); idle++;
  } else {
    const v = judge({ folder: folder(n), scenario, round: n, prev, evidence: evidence(ctx.lines, prevLines) });
    if (!v) { log('judge gave no usable verdict'); discard(root, rec.start); score(n, { checks: ctx.lines?.length, note: 'judge failed; edits discarded' }); break; }
    if (lowest(v) < lowest(prevVerdict)) {
      const why = `REVERTED: lowest criterion ${lowest(v)} < ${lowest(prevVerdict)} of the last accepted round`;
      log(`round ${n} ${why}; grades ${JSON.stringify(v.grades)}`); discard(root, rec.start);
      writeFileSync(FAILING, `Round ${n} was discarded: ${why}\ngrades ${JSON.stringify(v.grades)}\nJudge: ${readFileSync(join(folder(n), 'verdict.md'), 'utf8').slice(0, 4000)}\n`);
      score(n, { v, p: prevVerdict, checks: ctx.lines?.length, note: why }); idle++;
    } else {
      const changes = join(roundDir(n), 'changes.md'), sha = commitRound({ cwd: root, n, target: scenario.target, model: MODEL, body: existsSync(changes) ? readFileSync(changes, 'utf8') : '' });
      if (!sha) { log('nothing to commit after the checks'); score(n, { note: 'no change' }); idle++; }
      else {
        score(n, { v, p: prevVerdict, commit: sha, checks: ctx.lines.length });
        idle = KEYS.some(k => v.grades[k] > (prevVerdict.grades[k] ?? 0)) ? 0 : idle + 1;
        log(`round ${n} committed ${sha}; grades ${JSON.stringify(v.grades)}; ${ctx.lines.length} failing check lines`);
        prev = folder(n); prevVerdict = v; prevResult = ctx.shot.result; prevLines = ctx.lines; writeFileSync(LINES, JSON.stringify(prevLines)); rmSync(FAILING, { force: true });
      }
    }
  }
  rmSync(join(roundDir(n), 'eyes'), { recursive: true, force: true });
  const why = rec.status === 'failed' ? String(rec.reason).replace(/[\d.]+/g, '#') : ''; sameWhy = why && why === lastWhy ? sameWhy + 1 : why ? 1 : 0; lastWhy = why;
  if (sameWhy >= 2) { writeFileSync(join(HOME, 'STOP'), `two rounds in a row discarded for the same reason: ${rec.reason}\n`); log(`two rounds in a row discarded for the same reason (${rec.reason}): paused with STOP, the owner decides`); }
  if (idle >= MAX_IDLE) { log(`${MAX_IDLE} rounds in a row that improved nothing: stopping`); break; }
}
log('loop ended');
