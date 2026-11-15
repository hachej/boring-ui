#!/usr/bin/env node
// The improvement loop for one target: a worker (Codex, Sol) edits the kit in a git worktree, the harness captures, Opus judges, repeat.
//   UX_LOOP_HOME=/path nohup node ux/runner/loop.mjs --target layout:bar >> /path/loop.log 2>&1 &      stop: touch $UX_LOOP_HOME/<target-slug>/STOP
//   node ux/runner/loop.mjs --target layout:bar --baseline     capture + judge round 0 only        --dry-run   brief + one capture, no model
// State lives OUTSIDE the repo: $UX_LOOP_HOME/<target>/{round-N/<slug>/..., scoreboard.md, STOP}. Never pushes, merges or releases.
// The worker (sandboxed) only EDITS FILES. The loop does the rest: registry build, npm run check, the contract tests, the harness check and capture
// (up to three repair passes, each with the failing check by name and its real error lines), the judge; then it commits the round for the worker, or discards the edits (files checked out to the
// round's start commit; no reset --hard, no stash) when a check, the exam guard or a regression says so. See loop-round.mjs and ux/README.md.
// Ends when every graded criterion is >= 9 (status.json says done) or on STOP. A stall is not the end: each round targets one criterion (the lowest that has not stalled) and is told what was
// already tried; 3 rounds in a row with nothing accepted make the next a rethink round; 8 pause the loop (PAUSED, 6 h doubling to 24 h) and it resumes by itself. One loop per state folder (pid file).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { root } from './build.mjs';
import { capture, launch } from './capture.mjs';
import { check } from './check.mjs';
import { recordFlow } from './video.mjs';
import { judge, KEYS } from './judge.mjs';
import { checkSteps, commitRound, detailed, discard, errorText, failingTests, forbiddenTouched, incomplete, medianShiftLines, retried, runRound, saveTo, shiftKey, waitForLoad } from './loop-round.mjs';
import { loadAll, slug } from './scenario.mjs';
import { advise } from './advisor.mjs';
import { probeFlow } from './probe.mjs';
import { declared, declaredExcess, run as flowRun, totals, traceText, worstSteps } from './trace.mjs';
import { specBlock, specItems, advisorDue, triedRecent, allNine, addTried, claimPid, firstChange, focusBrief, overCap, pauseDue, pauseFor, pauseHours, pickFocus, readTried, releasePid, rethinkDue, triedText, updateMisses, writeStatus } from './loop-state.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const DRY = args.includes('--dry-run'), BASELINE = args.includes('--baseline');
const MAX_ROUNDS = Number(process.env.UX_MAX_ROUNDS ?? Infinity), REPAIRS = Number(process.env.UX_REPAIRS ?? 3), MAX_FILES = Number(process.env.UX_MAX_FILES ?? 8), LOAD_MAX = Number(process.env.UX_LOAD_MAX ?? 40);
const scenario = loadAll().find(s => s.target === opt('target')); if (!scenario) { console.error('usage: loop.mjs --target <layout:bar|component:...> [--baseline|--dry-run]'); process.exit(2); }
const HOME = join(process.env.UX_LOOP_HOME ?? join(homedir(), 'ux-loop'), slug(scenario.target)), S = slug(scenario.target);
const MODEL = process.env.UX_WORKER_MODEL ?? 'gpt-6.1-sol', SKILLS = process.env.UX_SKILLS ?? join(process.env.UX_LOOP_HOME ?? homedir(), 'skills');
const TEST_CMD = process.env.UX_TEST_CMD ?? 'CHROMIUM=$CHROMIUM node --test --test-reporter=tap test/contracts/one-composer.test.mjs test/contracts/agent-bar.test.mjs';
const MAIN = process.env.UX_MAIN_CHECKOUT; // optional: another checkout the loop must leave untouched
const ENV = { ...process.env, TMPDIR: '/var/tmp', PATH: `${homedir()}/.local/bin:${process.env.PATH}` }; delete ENV.CI;
const SHIFT_MARGIN = 0.1; // layout shift is exact from run to run (rounds 38 to 44 measured the same 1.69 seven times), so 0.1 of a threshold (0.008 of shift) is a clear step
const log = t => console.log(`${new Date().toISOString()} ${t}`);
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', env: ENV, maxBuffer: 1 << 28, ...o });
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const tail = (t, n = 30) => String(t).split('\n').slice(-n).join('\n');
const roundDir = n => join(HOME, `round-${n}`), folder = n => join(roundDir(n), S);
const readJson = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
const status = d => { if (!d) return ''; try { return execFileSync('git', ['-C', d, 'status', '--porcelain'], { encoding: 'utf8' }); } catch { return ''; } };
const gained = (a, b) => KEYS.some(k => typeof a?.[k] === 'number' && a[k] > (b?.[k] ?? 0));
const lowest = v => Math.min(...KEYS.map(k => v?.grades?.[k]).filter(x => typeof x === 'number'));
const FAILING = join(HOME, 'last-failure.txt'), LINES = join(HOME, 'check-lines.json'), TRIED = join(HOME, 'tried.json'), PID = join(HOME, 'loop.pid'), STATUS = join(HOME, 'status.json');
const SPEC_FILE = join(HOME, 'spec.md'), specText = () => existsSync(SPEC_FILE) ? readFileSync(SPEC_FILE, 'utf8').trim() : '';
const plan = { focus: null, rethink: false, failures: '', advisor: '', trace: '' }; // what the round in hand targets (set by the main loop before the worker runs)
// `layout:bar F01@1440 step 3 "Tap": layout shift 0.095 > 0.08` keyed with the numbers after the step name blanked: a metric moving is not a new problem.
const lineKey = shiftKey;

// Codex's sandbox cannot start a browser, so the loop measures for the worker: the steps most over their shift threshold in the last accepted capture, measured again now
// (same harness, shifted elements with their rectangles), and written into the brief. After the worker's pass the same numbers come from the check capture.
async function beforeTrace(prevResult) {
  const parts = [];
  try {
    const worst = worstSteps(scenario, prevResult), flows = [...new Set(worst.map(w => `${w.flow}@${w.viewport}`))];
    for (const id of flows) { const [flow, viewport] = id.split('@'), p = await retried(() => probeFlow(scenario, flow, viewport, join(HOME, '_probe')), { log, label: 'probe' }); parts.push(p.text({ only: worst.filter(w => w.flow === flow && w.viewport === viewport).map(w => w.step) })); }
  } catch (error) { log(`probe failed: ${String(error.message).split('\n')[0]}`); }
  return parts.length ? `\n## Measured now (the loop ran the harness on the steps most over their layout-shift threshold; you cannot start a browser, the loop can)\n${parts.join('\n\n')}\n` : '';
}

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
  const map = { N: n, TARGET: scenario.target, TITLE: scenario.title, SCENARIO: scenario.file, NOTES: scenario.notes ?? '', WT: root, BRANCH: git('branch', '--show-current'), TEST_CMD, EYES: eyesDir, PREV_DIR: join(eyesDir, 'capture', S), WORSE: worse, HOME, ROUND_DIR: roundDir(n), SKILLS, TRACE: plan.trace, SPEC: specBlock(specText()), FOCUS: focusBrief({ focus: plan.focus, problems: v?.problems?.[plan.focus] ?? [], raise: v?.to_raise?.[plan.focus] ?? '', blockers: (v?.worst_numbers ?? []).slice(0, 3), tried: triedText(readTried(TRIED), plan.focus), rethink: plan.rethink, failures: plan.failures, advisor: plan.advisor, max: MAX_FILES }), FEEDBACK: feedback ? `\n## What the loop found after your last pass (full output in ${roundDir(n)}). Fix exactly this; edit files only:\n${feedback}\n` : '' };
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
  const steps = checkSteps(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts?.check);
  if (!steps) run('npm run check', 'npm', ['run', 'check']);
  else for (const step of steps) { // each step alone: the failure names the step and carries its real error lines, not the head of a long output
    const r = sh('bash', ['-c', detailed(step)], { cwd: root, timeout: 30 * 60 * 1000 }), out = `${r.stdout}\n${r.stderr}`, name = `npm run check: ${step.replace('node scripts/', '')}`, file = join(dir, `${name.replace(/\W+/g, '-')}-${pass}.txt`);
    if (r.status === 0) continue;
    save(file.slice(dir.length + 1), out); log(`${name}: exit ${r.status}`); fails.push({ name, output: `${errorText(out)}\n(full output: ${file})` });
  }
  run('contract tests', 'bash', ['-c', TEST_CMD], true);
  if (fails.length) return fails;
  await waitForLoad({ max: LOAD_MAX, log });
  const { result: fast } = await retried(() => capture(scenario, join(dir, '_check'), { fast: true, probe: true }), { log, label: 'check capture' });
  ctx.lines = check(scenario, fast); ctx.fast = fast;
  if (ctx.lines.some(l => / layout shift /.test(l))) { // layout shift is noisy under load: a shift stays only when 2 of 3 captures show it
    const more = [];
    for (let i = 0; i < 2; i++) { await waitForLoad({ max: LOAD_MAX, log }); more.push(check(scenario, (await retried(() => capture(scenario, join(dir, '_check'), { fast: true }), { log, label: 'check capture' })).result)); }
    ctx.lines = medianShiftLines(ctx.lines, more);
  }
  rmSync(join(dir, '_check'), { recursive: true, force: true }); save(`check-lines-${pass}.txt`, ctx.lines.join('\n'));
  const seen = new Set(ctx.prevLines.map(lineKey)), fresh = ctx.lines.filter(l => !seen.has(lineKey(l)));
  log(`harness check: ${ctx.lines.length} failing lines (was ${ctx.prevLines.length}), ${fresh.length} not seen before; ${incomplete(ctx.lines).length} steps did not complete (was ${incomplete(ctx.prevLines).length})`);
  if (incomplete(ctx.lines).length > incomplete(ctx.prevLines).length) fails.push({ name: 'a step that completed before no longer completes', output: `${incomplete(ctx.lines).length} "did not complete" lines, was ${incomplete(ctx.prevLines).length}:\n${incomplete(ctx.lines).join('\n')}` });
  const aims = declared(existsSync(join(dir, 'changes.md')) ? readFileSync(join(dir, 'changes.md'), 'utf8') : ''), was = aims.length ? declaredExcess(scenario, ctx.prevResult, aims) : 0;
  if (aims.length && was > 0) { // the worker named the steps its change aims at: their layout shift must have fallen by a clear margin, or it gets the measured trace to repair from
    const now = declaredExcess(scenario, fast, aims), why = `Measure: ${aims.map(a => `${a.flow}@${a.viewport}${a.step ? `#${a.step}` : ''}`).join(', ')}: layout-shift excess ${was} before, ${now} now (a pass must fall by ${SHIFT_MARGIN} or more)`;
    log(`measured steps: ${why}`);
    if (now > was - SHIFT_MARGIN) fails.push({ name: 'the steps your change aims at did not improve', output: `${why}.\nThe loop measured them after your edit (shifted elements, largest first):\n${aims.map(a => { const r = flowRun(fast, a.flow, a.viewport); return r ? traceText(scenario, r, { only: a.step ? [a.step] : null, all: true }) : ''; }).join('\n')}\nFind the element above that moves, change what makes it move, and name in changes.md only steps you measured.` });
  }
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
function score(n, { v, p, commit = '-', checks = '-', note = '', excess = null }) {
  const cells = KEYS.map(k => v?.grades?.[k] ?? '-'), nums = cells.filter(x => typeof x === 'number');
  const up = v && p ? KEYS.filter(k => v.grades[k] > (p.grades[k] ?? 0)).join(', ') || 'none' : '-', down = v && p ? KEYS.filter(k => v.grades[k] < (p.grades[k] ?? 0)).join(', ') || 'none' : '-';
  const claimed = specText() ? specItems(existsSync(join(roundDir(n), 'changes.md')) ? readFileSync(join(roundDir(n), 'changes.md'), 'utf8') : '') : [];
  const file = join(HOME, DRY ? 'scoreboard.dry.md' : 'scoreboard.md'); mkdirSync(HOME, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `| round | ${KEYS.join(' | ')} | lowest | improved | worse | failing check lines | commit | result |\n|${'---|'.repeat(KEYS.length + 6)}\n`);
  appendFileSync(file, `| ${n} | ${cells.join(' | ')} | ${nums.length ? Math.min(...nums) : '-'} | ${up} | ${down} | ${checks ?? '-'} | ${commit} | ${(`${note}${excess === null ? '' : ` [shift excess ${excess}]`}${claimed.length ? ` [spec ${claimed.join(',')}]` : ''}`).replace(/\s+/g, ' ').slice(0, 300)} |\n`);
}
// Handed to the judge: the loop vetoes only on the fast checks, the contract tests, a step that stopped completing and the exam; the rest is evidence.
const evidence = (lines, before) => `Failing check lines now: ${lines.length} (accepted round before: ${before.length}). Steps that do not complete now: ${incomplete(lines).length} (before: ${incomplete(before).length}).\n${lines.length ? lines.join('\n') : 'none'}\n`;

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
// Resume after the last ACCEPTED round (rounds that failed or were reverted keep their folder but are not the state of the branch).
const graded = readdirSync(HOME).map(d => /^round-(\d+)$/.exec(d)?.[1]).filter(Boolean).map(Number).filter(k => existsSync(join(folder(k), 'verdict.json')));
let n = (graded.length ? Math.max(...graded) : 0) + 1;
let prev = folder(n - 1), prevVerdict = readJson(join(prev, 'verdict.json')), prevResult = readJson(join(prev, 'result.json'));
const baselineText = join(HOME, 'baseline-after-port.txt');
let prevLines = readJson(LINES) ?? (existsSync(baselineText) ? readFileSync(baselineText, 'utf8').split('\n').filter(l => /^\s{2,}\S/.test(l)).map(l => l.trim()) : []);
if (!prevVerdict && !DRY) { log('no round-0 verdict: run --baseline first'); process.exit(1); }
if (args.includes('--advise')) { // one real advisor call against the current state, then exit (no worker, no pid claim)
  mkdirSync(roundDir(n), { recursive: true });
  const a = advise({ scenario, verdict: prevVerdict, tried: triedRecent(readTried(TRIED)), failures: existsSync(FAILING) ? readFileSync(FAILING, 'utf8') : '', folder: prev, home: HOME, root, spec: specText(), out: join(roundDir(n), 'advisor.md') });
  log(a.plan ? `advise: plan written to ${join(roundDir(n), 'advisor.md')}` : `advise: failed (${a.why})`); process.exit(a.plan ? 0 : 1);
}
if (!DRY) { // one loop per state folder, checked by pid
  const claim = claimPid(PID); if (!claim.ok) { log(`another loop is running (pid ${claim.pid}, ${PID}): not starting a second one`); process.exit(3); }
  process.on('exit', () => releasePid(PID));
}
let failedInRow = 0, pauses = 0, misses = {}, advisedThisEpisode = false, lastAdvisedRound = null, lastAccepted = prevVerdict ? { round: n - 1, grades: prevVerdict.grades } : null, recent = [], lastResult = '';
if (!DRY) { const old = readJson(STATUS); if (old) { failedInRow = old.failedInRow ?? 0; misses = old.misses ?? {}; } } // a restart keeps the stuck count and the rotation
const stopped = () => existsSync(join(HOME, 'STOP')), say = s => { if (!DRY) writeStatus(STATUS, { target: scenario.target, pid: process.pid, lastAccepted, failedInRow, misses, ...s }); };
log(`start ${scenario.target} at round ${n}${DRY ? ' (dry run)' : ''}, branch ${git('branch', '--show-current')}, ${prevLines.length} failing check lines to start from`);
for (; n <= MAX_ROUNDS; n++) {
  if (stopped()) { log('STOP file found'); say({ state: 'stopped', round: n, nextWake: null }); break; }
  if (prevVerdict && allNine(prevVerdict.grades, KEYS)) { log(`done: every criterion is at 9 or more after round ${lastAccepted?.round} (${JSON.stringify(prevVerdict.grades)})`); say({ state: 'done', round: n - 1, focus: null, nextWake: null }); break; }
  if (pauseDue(failedInRow)) { // a pause, not an end: PAUSED says why, the loop sleeps (6 h, doubling to 24 h), then rethinks and resumes
    const hours = pauseHours(pauses++), wake = new Date(Date.now() + hours * 3600e3).toISOString(), why = `${failedInRow} rounds in a row with nothing accepted: paused ${hours} h until ${wake}, then a rethink round`;
    writeFileSync(join(HOME, 'PAUSED'), `${why}\n`); score(n, { note: `PAUSED: ${why}` }); log(why); say({ state: 'paused', round: n, nextWake: wake, reason: why });
    const woke = await pauseFor(hours * 3600e3, { stopped }); rmSync(join(HOME, 'PAUSED'), { force: true });
    if (woke === 'stop') { log('STOP file found during the pause'); say({ state: 'stopped', round: n, nextWake: null }); break; }
    failedInRow = 3; advisedThisEpisode = false; log('pause over: resuming with a rethink round');
  }
  plan.focus = pickFocus(prevVerdict?.grades, KEYS, misses); plan.rethink = rethinkDue(failedInRow);
  plan.failures = plan.rethink ? (recent.length ? recent.join('\n\n---\n\n') : existsSync(FAILING) ? readFileSync(FAILING, 'utf8') : '(no failure text kept)') : '';
  plan.advisor = '';
  if (!DRY && advisorDue({ failedInRow, advisedThisEpisode, round: n, lastAdvisedRound })) { // stuck: Opus plans once, the worker follows it; a failure leaves a plain rethink round
    advisedThisEpisode = true; lastAdvisedRound = n; mkdirSync(roundDir(n), { recursive: true }); say({ state: 'advising', round: n, focus: plan.focus, advisor: true, nextWake: null });
    const a = advise({ scenario, verdict: prevVerdict, tried: triedRecent(readTried(TRIED)), failures: plan.failures, folder: prev, home: HOME, root, spec: specText(), out: join(roundDir(n), 'advisor.md') });
    if (a.plan) { plan.advisor = a.plan; log(`round ${n}: advisor (Opus) wrote a plan: ${join(roundDir(n), 'advisor.md')}`); } else log(`round ${n}: advisor failed (${a.why}); plain rethink round`);
  }
  plan.trace = DRY ? '' : await beforeTrace(prevResult);
  say({ state: 'running', round: n, focus: plan.focus, rethink: plan.rethink, advisor: Boolean(plan.advisor), shiftExcess: totals(scenario, prevResult).shift, settleExcess: totals(scenario, prevResult).settle, nextWake: null });
  log(`round ${n}: target ${plan.focus}${plan.rethink ? ' (rethink round)' : ''}, ${failedInRow} failed in a row`);
  const mainBefore = status(MAIN), ctx = { prevLines, prevResult }, before = prevVerdict?.grades;
  if (DRY) { worker(n, prev, prevLines, '', ''); await waitForLoad({ max: LOAD_MAX, log }); const s = await retried(() => capture(scenario, roundDir(n)), { log }); log(`dry run: ${check(scenario, s.result).length} check lines`); break; }
  const rec = await runRound({
    cwd: root, save: saveTo(roundDir(n)), log, repairs: REPAIRS,
    runWorker: ({ feedback, tag }) => worker(n, prev, prevLines, feedback, tag),
    refuse: changed => [...forbiddenTouched(changed).map(f => `the worker changed ${f}: the harness, the contract and the rubric are not the worker's to edit`), ...overCap(changed.filter(f => !f.startsWith('public/r/')), MAX_FILES), ...(status(MAIN) !== mainBefore ? ['the main checkout changed; it must never be touched.'] : [])],
    runChecks: changed => loopChecks(n, changed, ctx),
  });
  const changesText = () => { const f = join(roundDir(n), 'changes.md'); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
  const lost = (result, note) => { // nothing accepted this round: remember what was tried, count the miss, keep the failure text for a rethink
    lastResult = `round ${n} discarded: ${note}`.slice(0, 300); failedInRow++; misses = updateMisses(misses, plan.focus, before, before); addTried(TRIED, { round: n, criterion: plan.focus, result, note: `${note}${changesText() ? `; tried: ${firstChange(changesText())}` : ''}` });
    recent = [...recent, String(existsSync(FAILING) ? readFileSync(FAILING, 'utf8') : note).slice(0, 3000)].slice(-3);
  };
  if (rec.status === 'no-change') { log(`round ${n}: no change (the worker edited nothing)`); score(n, { note: 'no change: the worker edited nothing' }); lost('no change', 'the worker edited nothing'); }
  else if (rec.status === 'failed') {
    log(`round ${n} FAILED, edits discarded (back at ${rec.start.slice(0, 9)}): ${rec.reason}`);
    writeFileSync(FAILING, `Round ${n} was discarded: ${rec.reason}\n${[...Array(REPAIRS + 1)].map((_, i) => `failure-${i + 1}.txt`).concat('refused.txt').map(f => join(roundDir(n), f)).filter(existsSync).slice(-2).map(f => readFileSync(f, 'utf8')).join('\n').slice(-6000)}\n`);
    score(n, { checks: ctx.lines?.length, excess: ctx.fast ? totals(scenario, ctx.fast).shift : null, note: `FAILED: ${rec.reason}` }); lost('failed', rec.reason);
  } else {
    const v = judge({ folder: folder(n), scenario, round: n, prev, evidence: evidence(ctx.lines, prevLines) });
    if (!v) { log('judge gave no usable verdict'); discard(root, rec.start); score(n, { checks: ctx.lines?.length, excess: ctx.fast ? totals(scenario, ctx.fast).shift : null, note: 'judge failed; edits discarded' }); lost('judge failed', 'the judge gave no usable verdict'); }
    else if (!gained(v.grades, prevVerdict.grades) && ctx.lines.length >= prevLines.length) { // nothing rose and no check line went away: unmeasured change stays out of the branch
      const why = `NO GAIN: no criterion rose and failing check lines ${ctx.lines.length} (was ${prevLines.length}); edits discarded`;
      log(`round ${n} ${why}; grades ${JSON.stringify(v.grades)}`); discard(root, rec.start); renameSync(join(folder(n), 'verdict.json'), join(folder(n), 'verdict.nogain.json'));
      writeFileSync(FAILING, `Round ${n} was discarded: ${why}\nWhat you changed: ${firstChange(changesText())}\nJudge: ${readFileSync(join(folder(n), 'verdict.md'), 'utf8').slice(0, 4000)}\n`);
      score(n, { v, p: prevVerdict, checks: ctx.lines?.length, excess: ctx.fast ? totals(scenario, ctx.fast).shift : null, note: why }); lost('no gain', why);
    }
    else if (lowest(v) < lowest(prevVerdict)) {
      const why = `REVERTED: lowest criterion ${lowest(v)} < ${lowest(prevVerdict)} of the last accepted round`;
      log(`round ${n} ${why}; grades ${JSON.stringify(v.grades)}`); discard(root, rec.start); renameSync(join(folder(n), 'verdict.json'), join(folder(n), 'verdict.reverted.json'));
      writeFileSync(FAILING, `Round ${n} was discarded: ${why}\ngrades ${JSON.stringify(v.grades)}\nJudge: ${readFileSync(join(folder(n), 'verdict.md'), 'utf8').slice(0, 4000)}\n`);
      score(n, { v, p: prevVerdict, checks: ctx.lines?.length, excess: ctx.fast ? totals(scenario, ctx.fast).shift : null, note: why }); lost('reverted', why);
    } else {
      const sha = commitRound({ cwd: root, n, target: scenario.target, model: MODEL, body: changesText() });
      if (!sha) { log('nothing to commit after the checks'); score(n, { note: 'no change' }); lost('no change', 'nothing to commit after the checks'); }
      else {
        score(n, { v, p: prevVerdict, commit: sha, checks: ctx.lines.length, excess: totals(scenario, ctx.fast).shift });
        const gain = plan.focus && v.grades[plan.focus] > (before[plan.focus] ?? 0);
        addTried(TRIED, { round: n, criterion: plan.focus, result: gain ? 'accepted' : 'accepted, no gain on it', note: firstChange(changesText()) });
        misses = updateMisses(misses, plan.focus, before, v.grades); failedInRow = 0; pauses = 0; advisedThisEpisode = false; lastResult = `round ${n} accepted (${sha})`; recent = []; lastAccepted = { round: n, grades: v.grades };
        log(`round ${n} committed ${sha}; grades ${JSON.stringify(v.grades)}; ${ctx.lines.length} failing check lines`);
        prev = folder(n); prevVerdict = v; prevResult = ctx.shot.result; prevLines = ctx.lines; writeFileSync(LINES, JSON.stringify(prevLines)); rmSync(FAILING, { force: true });
      }
    }
  }
  rmSync(join(roundDir(n), 'eyes'), { recursive: true, force: true });
  say({ state: 'running', round: n, focus: plan.focus, lastVerdict: lastResult });
}
log('loop ended');
