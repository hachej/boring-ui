import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The shared runner imports Base UI before any DOM exists; the popover reads document-scoped state at import. Keep this DOM realm separate.
test('provider setup lists any registered provider with its models, key state, sign-in and gateway note in an isolated DOM realm', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./provider-setup-source.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 300000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-8000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
});
