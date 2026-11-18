import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Base UI binds to the first DOM realm it meets, and CI runs every test file in one process: the popover tests run in their own.
test('McpSetup runs in its own Base UI DOM realm', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./mcp-setup.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 180000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-12000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# pass 3$/m);
  assert.match(result.stdout, /^# fail 0$/m);
});
