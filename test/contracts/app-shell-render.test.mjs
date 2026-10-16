import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The app shell rendered in happy-dom (app-shell-render.impl.mjs) runs in its own node process: its DOM globals and timers must not reach the
// other test files, which the runner (--experimental-test-isolation=none) runs in one shared process.
test('app shell render (own process): locale, no agent, portalled popups, the theme switch, one layer at a time', () => {
  const impl = fileURLToPath(new URL('./app-shell-render.impl.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 600000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-4000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
