import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('pi-chat file cards, inline galleries and voice run in an isolated DOM realm', () => {
  // Base UI chooses its browser layout effects at import time; the full suite must not supply another test's module cache.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('../../scripts/css-stub-register.mjs', import.meta.url)), '--test', fileURLToPath(new URL('./pi-chat-file-cards.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 120000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-18000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
  assert.ok(Number(/^# tests (\d+)$/m.exec(result.stdout)?.[1]) >= 58, 'all retained file-card, voice and image regressions execute');
  for (const name of [
    'sent page comments round-trip the real formatter and render a localised card through PiChat',
    'sent feedback preserves surrounding prose, general notes, multiline punctuation and longer fences',
    'long sent feedback collapses behind a native button and opens without changing the report',
    'plain, malformed, non-page and assistant messages keep their existing text presentation',
    'one sent comment uses singular EN/FR labels and a long single note is collapsed',
  ]) assert.ok(result.stdout.split('\n').some(line => /^ok \d+ - /.test(line) && line.endsWith(name)), `D-207 case executed: ${name}`);
});
