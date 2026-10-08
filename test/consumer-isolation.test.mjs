import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareConsumerIsolation, assertConsumerTypeFiles } from '../scripts/consumer-isolation.mjs';
import { runCaptured } from '../scripts/run-captured.mjs';

test('isolated consumers reject dependency escapes at runtime and in compiler input, including symlinks', t => {
  const root = mkdtempSync(join(tmpdir(), 'boring-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumer = join(root, 'consumer'); mkdirSync(consumer);
  const env = prepareConsumerIsolation(consumer);
  writeFileSync(join(root, 'outside.mjs'), 'export const value = 1;');
  writeFileSync(join(consumer, 'inside.mjs'), 'export const value = 2;');
  symlinkSync(join(root, 'outside.mjs'), join(consumer, 'alias.mjs'));
  const run = source => runCaptured(process.execPath, ['--input-type=module', '-e', source], { cwd: consumer, env });
  assert.equal(run("import './inside.mjs'").status, 0);
  assert.equal(run("import './alias.mjs'").status, 1);
  assert.match(run("import '../outside.mjs'").stderr, /escaped installation/);
  assert.doesNotThrow(() => assertConsumerTypeFiles(join(consumer, 'inside.mjs'), consumer));
  assert.throws(() => assertConsumerTypeFiles(join(root, 'outside.mjs'), consumer), /outside/);
  assert.throws(() => assertConsumerTypeFiles(join(consumer, 'alias.mjs'), consumer), /outside/);
});
