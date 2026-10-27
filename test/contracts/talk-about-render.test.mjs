import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('talkAbout public layer, mention kinds and native send paths', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./talk-about-render.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 180000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-16000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
