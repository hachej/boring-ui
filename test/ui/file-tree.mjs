import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Base UI keeps document-scoped state. Run the full controller/renderer suite in its own DOM realm.
test('file tree controller and real shadcn presentation in an isolated Base UI realm', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./file-tree.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 600000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-24000)}\n${result.stderr.slice(-6000)}`);
  assert.match(result.stdout, /^# pass [1-9]\d*$/m);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
  assert.match(result.stdout, /^# todo 0$/m);
});
