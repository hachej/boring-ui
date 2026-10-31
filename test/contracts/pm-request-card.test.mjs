import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('PM request cards run in their own Base UI DOM realm', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./pm-request-card.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 300000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-12000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
