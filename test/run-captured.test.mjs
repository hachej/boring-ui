import assert from 'node:assert/strict';
import test from 'node:test';
import { runCaptured } from '../scripts/run-captured.mjs';

test('verification capture retains actual stdout, stderr, argument bytes and nonzero exit', () => {
  const argument = 'literal $HOME; `not-a-shell`\nsecond line';
  const result = runCaptured(process.execPath, ['-e', 'process.stdout.write(process.argv[1]); process.stderr.write("failure evidence"); process.exitCode = 7', argument]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 7);
  assert.equal(result.stdout, argument);
  assert.equal(result.stderr, 'failure evidence');
});

test('failed spawn and timeout cannot be reported as successful evidence', () => {
  const absent = runCaptured('/nonexistent/boring-verification-command', []);
  assert.equal(absent.error.code, 'ENOENT');
  assert.notEqual(absent.status, 0);
  const timedOut = runCaptured(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 });
  assert.equal(timedOut.error.code, 'ETIMEDOUT');
  assert.notEqual(timedOut.status, 0);
});

test('oversized output fails evidence and is bounded when loaded into memory', () => {
  const result = runCaptured(process.execPath, ['-e', 'process.stdout.write("0123456789")'], { maxBuffer: 1 });
  assert.equal(result.error.code, 'ENOBUFS');
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '0');
});

test('explicit installer cache survives capture and child tools do not inherit the parent test channel', () => {
  const cache = '/tmp/fictional-explicit-cache';
  const result = runCaptured(process.execPath, ['-e', 'console.log(JSON.stringify({ cache: process.env.npm_config_cache, test: process.env.NODE_TEST_CONTEXT }))'], { env: { ...process.env, npm_config_cache: cache, NODE_TEST_CONTEXT: 'child-v8' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { cache });
});
