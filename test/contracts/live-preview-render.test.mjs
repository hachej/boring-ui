import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The live preview rendered in happy-dom (live-preview-render.impl.mjs) runs in its own node process, like app-shell-render.test.mjs.
test('live preview render (own process): the chat card, the preview view, share and the kill switch', () => {
  const impl = fileURLToPath(new URL('./live-preview-render.impl.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 600000 });
  assert.equal(result.status, 0, `${result.stdout.slice(-4000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
