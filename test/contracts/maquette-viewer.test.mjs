import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The maquette viewer (maquette-viewer.impl.mjs) runs in its own node process, like the kit's extension points: the artifact panel loads the
// Markdown editor's modules, which must not be evaluated in this shared process before the editor's own DOM tests install theirs.
test('maquette viewer through the artifact panel (own process)', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-force-exit', fileURLToPath(new URL('./maquette-viewer.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 600000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-12000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
});
