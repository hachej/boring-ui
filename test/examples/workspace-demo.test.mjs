// The workspace demo's server, driven through its own tools with the scripted model: `show` refuses paths that are not plain workspace files
// (before any command is queued), an agent write mints no receipt, and a restart on the same data folder seeds again without failing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { validWorkspacePath } from '../../demos/workspace/paths.mjs';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceDemo } = await import('../../demos/workspace/server.mjs');

const say = async (app, content) => {
  const conversation = await app.conversations.open('ap-helper', Number(app.current));
  await (await conversation.submit({ type: 'input', requestId: `test-${Math.random().toString(36).slice(2)}`, content }, context)).wait(context);
};

test('validWorkspacePath keeps plain relative paths and refuses the rest', () => {
  assert.equal(validWorkspacePath('./tt.md'), 'tt.md');
  assert.equal(validWorkspacePath('Policies/AP policy.md'), 'Policies/AP policy.md');
  for (const bad of ['../x', 'a/../b', '/etc/passwd', 'a//b', 'a\\b', '', '.', 'a/./b', undefined, 'a\u0000b']) assert.equal(validWorkspacePath(bad), undefined, JSON.stringify(bad));
});

test('the show tool queues a normalised file path and refuses invalid or missing ones; an agent write adds no receipt', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-workspace-demo-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = await startWorkspaceDemo({ directory, scripted: true });
  try {
    const receipts = app.publications();
    await say(app, 'open with dotted path please');
    assert.deepEqual(app.navigation.map(({ screen, path }) => [screen, path]), [['file', 'dot.md']], './dot.md is queued as dot.md');
    assert.equal(app.publications(), receipts, 'the agent write minted no receipt');
    for (const request of ['open escaping path', 'open absolute path', 'open missing file']) await say(app, request);
    assert.equal(app.navigation.length, 1, 'nothing else was queued');
  } finally { await app.close(); }
});

test('a restart on the same data folder seeds again: same ids, no duplicate conversations', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-workspace-demo-restart-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = await startWorkspaceDemo({ directory, scripted: true });
  const [current, earlier] = [first.current, first.earlier];
  await first.close();
  const second = await startWorkspaceDemo({ directory, scripted: true });
  try {
    assert.equal(second.current, current, 'the same current conversation');
    assert.deepEqual([...second.earlier].sort(), [...earlier].sort(), 'the same earlier conversations, not seeded again');
  } finally { await second.close(); }
});
