import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const directory = new URL('../../.cache/', import.meta.url);
const steps = ['studio-scripted', 'studio-smoke', 'verify'].flatMap(name => {
  const source = readFileSync(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
  return source.split(/(?=^      -)/m).filter(step => /(?:playwright@.*install|bash scripts\/install-ci-chromium\.sh)/.test(step)).map(step => {
    const run = /^        run: (.+)$/m.exec(step)?.[1];
    const body = run === '|' ? step.split('        run: |\n')[1].split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n') : run;
    return { name, step, body: body.replaceAll('${{ env.PLAYWRIGHT_VERSION }}', '1.63.0') };
  });
});

function fixture(t, scenario = 'ready') {
  mkdirSync(directory, { recursive: true });
  const path = mkdtempSync(join(directory.pathname, 'ci-chromium-'));
  t.after(() => {
    // A failing pre-fix control must not leave its deliberately TERM-resistant fixture behind.
    if (existsSync(join(path, 'descendant'))) {
      const pid = readFileSync(join(path, 'descendant'), 'utf8').trim();
      try {
        const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
        if (fields[0] !== 'Z') process.kill(-Number(fields[2]), 'SIGKILL');
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      }
    }
    rmSync(path, { recursive: true, force: true });
  });
  const commands = {
    npx: `#!/bin/bash
set -eu
printf 'npx %s\\n' "$*" >> "$LOG"
case "$*" in
  '--yes playwright@1.63.0 install chromium-headless-shell'|'--yes playwright@1.63.0 install --with-deps chromium-headless-shell') kind=browser ;;
  '--yes playwright@1.63.0 install-deps chromium-headless-shell')
    kind=deps
    grep -q 'DPkg::Lock::Timeout "120";' "$APT_CONFIG"
    printf 'apt lock timeout configured\\n' >> "$LOG"
    ;;
  *) exit 93 ;;
esac
count=0
[[ ! -f "$FIXTURE/$kind-count" ]] || count=$(< "$FIXTURE/$kind-count")
echo $((count+1)) > "$FIXTURE/$kind-count"
if [[ "$SCENARIO" = fail ]]; then exit 7; fi
if [[ "$SCENARIO" = retry && "$count" = 0 ]]; then exit 1; fi
if [[ ( "$SCENARIO" = "hang-$kind" || "$SCENARIO" = "cancel-$kind" ) && "$count" = 0 ]]; then
  # Reproduce an installer exiting on TERM while its apt-like child ignores it and holds a lock.
  bash -c 'trap "" TERM; echo "$BASHPID" > "$FIXTURE/descendant"; exec 9>"$FIXTURE/lock"; flock 9; touch "$FIXTURE/locked"; while :; do sleep 1; done' &
  while [[ ! -f "$FIXTURE/locked" ]]; do sleep 0.01; done
  wait
fi
# A retry must not begin while an orphan still owns the apt-like lock.
if ! flock -n "$FIXTURE/lock" true; then
  echo 'fixture lock still held by installer descendant' >&2
  exit 73
fi
[[ "$kind" != deps || "$SCENARIO" = still-missing ]] || touch "$FIXTURE/deps-installed"
`,
    ldd: `#!/bin/bash
printf 'ldd %s\\n' "$*" >> "$LOG"
[[ "$1" = "$CHROMIUM" ]] || exit 91
if [[ "$SCENARIO" = ldd-error ]]; then echo 'ldd: cannot inspect executable' >&2; exit 1; fi
if [[ "$SCENARIO" = missing || "$SCENARIO" = hang-deps || "$SCENARIO" = cancel-deps || "$SCENARIO" = still-missing ]] && [[ ! -f "$FIXTURE/deps-installed" ]]; then
  echo 'libfictional.so => not found'
else
  echo 'libfictional.so => /lib/libfictional.so (0x1234)'
fi
`,
    sudo: `#!/bin/bash
printf 'sudo %s\\n' "$*" >> "$LOG"
[[ "$1" != -n ]] || shift
exec "$@"
`,
    timeout: `#!/bin/bash
set -eu
printf 'timeout %s\\n' "$*" >> "$LOG"
# Also execute the pre-fix workflow for the failing-before control, rather than fail in this mock's argument parser.
if [[ "$1" = 300 ]]; then shift; else
  [[ "$1" = --kill-after=10s && "$2" = 300 ]] || exit 92
  shift 2
fi
# Accelerate only local process-tree regressions, leaving time for explicit cancellation tests.
seconds=0.5s
[[ "$SCENARIO" != cancel-* ]] || seconds=5s
exec /usr/bin/timeout --kill-after=0.1s "$seconds" "$@"
`,
  };
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(path, name), body);
    chmodSync(join(path, name), 0o755);
  }
  const env = { ...process.env, PATH: `${path}:${process.env.PATH}`, SCENARIO: scenario, FIXTURE: path, LOG: join(path, 'commands'), CHROMIUM: join(path, 'chrome-headless-shell'), TMPDIR: path };
  return {
    path,
    run: step => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.body], { cwd: root, encoding: 'utf8', timeout: 3000, env }),
    start: step => spawn('bash', ['-e', '-o', 'pipefail', '-c', step.body], { cwd: root, env }),
    log: () => readFileSync(join(path, 'commands'), 'utf8'),
  };
}

function assertDescendantStopped(path) {
  const pid = readFileSync(join(path, 'descendant'), 'utf8').trim();
  const stat = `/proc/${pid}/stat`;
  // A reparented zombie cannot run or hold a file lock; PID 1 owns its eventual reap.
  assert.ok(!existsSync(stat) || readFileSync(stat, 'utf8').split(') ')[1].startsWith('Z'), `descendant ${pid} still running`);
  assert.equal(spawnSync('flock', ['-n', join(path, 'lock'), 'true']).status, 0, 'descendant released its lock');
}

test('all four workflow installs skip apt and extra fonts when the cached browser libraries are present', t => {
  assert.equal(steps.length, 4);
  for (const step of steps) {
    assert.match(step.step, /timeout-minutes: 8/);
    const f = fixture(t);
    const ran = f.run(step);
    assert.equal(ran.status, 0, `${step.name}: ${ran.stderr}`);
    assert.match(f.log(), /^timeout --kill-after=10s 300 npx --yes playwright@1\.63\.0 install chromium-headless-shell/m);
    assert.doesNotMatch(f.log(), /--with-deps|install-deps|sudo /);
    assert.match(f.log(), /ldd /);
  }
});

test('missing libraries alone trigger the bounded, lock-waiting dependency fallback, then ldd is checked again', t => {
  for (const step of steps) {
    const f = fixture(t, 'missing');
    const ran = f.run(step);
    assert.equal(ran.status, 0, `${step.name}: ${ran.stderr}`);
    assert.equal((f.log().match(/^npx .* install-deps /gm) ?? []).length, 1);
    assert.match(f.log(), /^timeout --kill-after=10s 300 env APT_CONFIG=.* npx --yes playwright@1\.63\.0 install-deps chromium-headless-shell/m);
    assert.match(f.log(), /apt lock timeout configured/);
    assert.equal((f.log().match(/^ldd /gm) ?? []).length, 2);
    assert.equal(existsSync(join(f.path, 'deps-installed')), true);
    assert.equal(spawnSync('bash', ['-c', 'compgen -G "$1/ci-chromium-apt.*"', '--', f.path]).status, 1, 'temporary apt config removed');
  }
});

test('the binary installer retries once on failure, and preserves the final failure', t => {
  const retried = fixture(t, 'retry');
  const success = retried.run(steps[0]);
  assert.equal(success.status, 0, success.stderr);
  assert.equal((success.stdout.match(/::notice::/g) ?? []).length, 1);
  assert.equal((retried.log().match(/^npx /gm) ?? []).length, 2);
  const failed = fixture(t, 'fail');
  const failure = failed.run(steps[0]);
  assert.equal(failure.status, 7, failure.stderr);
  assert.equal((failed.log().match(/^npx /gm) ?? []).length, 2);
  assert.doesNotMatch(failed.log(), /^ldd /m);
});

for (const kind of ['browser', 'deps']) test(`a timed-out ${kind} installer kills its TERM-resistant process group and releases the lock before retry`, t => {
  const f = fixture(t, `hang-${kind}`);
  const ran = f.run(steps[0]);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal((ran.stdout.match(/::notice::/g) ?? []).length, 1);
  assert.equal(readFileSync(join(f.path, `${kind}-count`), 'utf8').trim(), '2');
  assertDescendantStopped(f.path);
});

for (const kind of ['browser', 'deps']) test(`cancelling the step stops the ${kind} process group without retrying`, async t => {
  const f = fixture(t, `cancel-${kind}`);
  const child = f.start(steps[0]);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', () => {});
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  t.after(() => child.kill('SIGKILL'));
  const deadline = Date.now() + 3000;
  while (!existsSync(join(f.path, 'locked')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(existsSync(join(f.path, 'locked')), true, 'installer descendant has acquired its lock');
  child.kill('SIGTERM');
  const result = await closed;
  assert.equal(result.code, 143, JSON.stringify(result));
  assertDescendantStopped(f.path);
  assert.doesNotMatch(output, /::notice::/);
  assert.equal(readFileSync(join(f.path, `${kind}-count`), 'utf8').trim(), '1');
});

test('ldd inspection errors and unresolved libraries fail instead of silently accepting an unusable browser', t => {
  const error = fixture(t, 'ldd-error');
  assert.notEqual(error.run(steps[0]).status, 0);
  assert.doesNotMatch(error.log(), /sudo |install-deps/);
  const missing = fixture(t, 'still-missing');
  assert.notEqual(missing.run(steps[0]).status, 0);
  assert.equal((missing.log().match(/^npx .* install-deps /gm) ?? []).length, 1);
});
