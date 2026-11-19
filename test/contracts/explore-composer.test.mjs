import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `composer="explore"` rendered in happy-dom (explore-composer.impl.mjs) runs in its own node process: its DOM globals and timers must not reach the
// other test files, which the runner (--experimental-test-isolation=none) runs in one shared process.
test('explore composer (own process): closed by default, toggle, push, overlay and sheet, shortcut, Esc, focus, unread and needs-you, context, French, remembered width', () => {
  const impl = fileURLToPath(new URL('./explore-composer.impl.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 600000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-6000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
