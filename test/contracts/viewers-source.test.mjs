import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('the public Markdown guide documents current defaults and the owner teardown barrier', () => {
  const readme = readFileSync(new URL('../../packages/ui/README.md', import.meta.url), 'utf8');
  const editor = readme.split('## Optional Markdown editor')[1].split('### Mounted Markdown commands')[0];
  assert.match(editor, /Formatting defaults to the pinned desktop toolbar\./);
  assert.match(editor, /autosave.*default.*1200|default.*autosave.*1200/i);
  assert.match(editor, /autosave=\{false\}/);
  assert.match(editor, /onAutosaveChange/);
  assert.match(editor, /await.*flush/i);
  assert.match(editor, /before.*clos.*unmount.*dispos/i);
  assert.match(editor, /\(\.\.\/\.\.\/registry\/README\.md\)/);
});

// Base UI binds document-scoped event state. Keep this DOM realm out of the shared test runner.
test('viewer controls, browser-only files, menus, publication and legacy header behavior in an isolated DOM realm', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./viewers-source.impl.mjs', import.meta.url))], { encoding: 'utf8', timeout: 600000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-12000)}\n${result.stderr.slice(-3000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
});
