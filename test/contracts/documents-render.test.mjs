import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The documents item (registry/documents) rendered in happy-dom by documents-render.impl.mjs, in its own node process: its DOM globals,
// timers and the shell's Back manager must not reach the other test files, which the runner runs in one shared process.
test('documents (own process): the Library lists and opens a file, the revisions open an old one read-only, DocumentSheet closes on Back, useShellLayer closes the agent', () => {
  const impl = fileURLToPath(new URL('./documents-render.impl.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 600000 });
  assert.equal(result.status, 0, `${result.stdout.slice(-4000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
