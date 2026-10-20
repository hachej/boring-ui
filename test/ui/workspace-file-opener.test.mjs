import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Host file-opener precedence runs in an isolated DOM realm', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./workspace-file-opener.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 120000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-12000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
});
