import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createArtifactDescriptor, createPresentTool, parseArtifact, parsePresentedArtifact, parseTaskSubject, createTaskArtifact } from '@hachej/boring-agent/artifacts';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';

const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };

function workspaceFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-present-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  t.after(() => { db.close(); rmSync(directory, { force: true, recursive: true }); });
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const files = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' } });
  return { fs, files };
}
const ctx = { abortSignal: new AbortController().signal };
// A constant workspace ignores the call's target, so the tool's API needs only `agent` (its working directory).
const api = { conversationId: 'fictional-conversation', agent: async () => ({}) };
const presentOf = (tool, path) => tool.execute({ path }, api, {}).then(result => JSON.parse(result.output[0].text));

test('present shows the file at the given relative path, and refuses an absolute one instead of reading another file', async t => {
  const { fs, files } = workspaceFixture(t);
  await fs.writeFile('/workspace/report.md', '# root copy', ctx);
  await fs.writeFile('/workspace/workspace/report.md', '# nested copy', ctx);
  const tool = createPresentTool({ workspace: { files, root: '/workspace', access } });
  const shown = await presentOf(tool, './report.md');
  assert.equal(shown.kind, 'presented');
  assert.equal(shown.artifact.target.resource.path, 'report.md');
  const absolute = await presentOf(tool, '/workspace/report.md');
  assert.equal(absolute.kind, 'denied');
  assert.equal(absolute.artifact, undefined);
});

test('a file the journal has no version of reports its real media type, not octet-stream', async t => {
  const { fs, files } = workspaceFixture(t);
  await fs.writeFile('/workspace/scan.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ctx);
  const read = await files.read({ target: { resource: { providerId: 'files', path: 'scan.png' }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
  assert.equal(read.kind, 'available');
  assert.equal(read.snapshot.mediaType, 'image/png');
});

test('present names a file with an inherited extension as plain text, never as a native type', async t => {
  const { fs, files } = workspaceFixture(t);
  await fs.writeFile('/workspace/notes.constructor', 'plain', ctx);
  const tool = createPresentTool({ workspace: { files, root: '/workspace', access } });
  const shown = await presentOf(tool, 'notes.constructor');
  assert.equal(shown.kind, 'presented');
  assert.equal(shown.artifact.type, 'code');
  assert.equal(shown.artifact.mediaType, 'text/plain');
  assert.equal(shown.artifact.language, undefined);
});

test('parseArtifact accepts a built descriptor and rejects malformed ones', () => {
  const good = createArtifactDescriptor({ id: 'abc123', title: 'Fictional', type: 'code', mediaType: 'text/plain', language: 'python',
    target: { resource: { providerId: 'documents', path: 'artifacts/abc123.py' }, view: { kind: 'published' } }, revision: 'r1', ordinal: 2 });
  assert.equal(good.schema, 'boring.artifact');
  assert.deepEqual(parseArtifact(JSON.parse(JSON.stringify(good))), good);
  assert.notEqual(parseArtifact(good), good, 'a fresh copy');
  const bad = [undefined, null, 'x', [], {}, { ...good, schema: 'other' }, { ...good, version: 2 }, { ...good, id: '' }, { ...good, id: '../x' }, { ...good, title: ' ' }, { ...good, type: 'pdf' },
    { ...good, mediaType: 'nope' }, { ...good, language: 7 }, { ...good, revision: '' }, { ...good, ordinal: 0 }, { ...good, ordinal: 1.5 }, { ...good, ordinal: '1' }, { ...good, extra: true },
    { ...good, target: { resource: { providerId: 'documents' }, view: { kind: 'published' } } }, { ...good, target: { resource: good.target.resource, view: { kind: 'working' } } },
    { ...good, target: { resource: good.target.resource, view: { kind: 'published', extra: 1 } } }, { ...good, target: { ...good.target, extra: 1 } }];
  for (const value of bad) assert.equal(parseArtifact(value), undefined, JSON.stringify(value));
  assert.throws(() => createArtifactDescriptor({ ...good, ordinal: 0 }), /Invalid artifact descriptor/);
  assert.ok(parseArtifact({ ...good, target: { resource: good.target.resource, view: { kind: 'working', viewId: 'v' } } }));
});


test('task artifact parsing stays strict and browser/server descriptors agree without file metadata', async () => {
  const browser = await import('@hachej/boring-ui-kit/chat-view');
  for (const subject of [{ task: 'D-201' }, { task: '417' }, { tasks: { filter: 'all' } }, { tasks: { filter: 'mine' } }, { tasks: { filter: 'waiting-on-me' } }]) {
    const artifact = createTaskArtifact(subject);
    assert.deepEqual(parsePresentedArtifact(artifact), artifact);
    assert.deepEqual(browser.parsePresentedArtifact(artifact), artifact);
    assert.notEqual(parsePresentedArtifact(artifact).subject, artifact.subject, 'the parser detaches the reference');
    assert.equal(parseArtifact(artifact), undefined, 'the old parser remains file-only');
  }
  const good = createTaskArtifact({ task: 'D-201' });
  const malformed = [null, {}, { ...good, version: 2 }, { ...good, title: '' }, { ...good, revision: 'r1' }, { ...good, type: 'markdown' },
    { ...good, subject: { task: '../D-201' } }, { ...good, subject: { task: '' } }, { ...good, subject: { task: 'D-201', extra: true } },
    { ...good, subject: { task: 'D-201', tasks: { filter: 'mine' } } }, { ...good, subject: { tasks: {} } }, { ...good, subject: { tasks: { filter: 'other' } } },
    { ...good, subject: { tasks: { filter: 'mine', principal: 'another-person' } } }, { ...good, subject: { tasks: { filter: 'mine' }, extra: true } }];
  for (const value of malformed) {
    assert.equal(parsePresentedArtifact(value), undefined, JSON.stringify(value));
    assert.equal(browser.parsePresentedArtifact(value), undefined, JSON.stringify(value));
  }
  assert.equal(parseTaskSubject({ task: 'D-201', path: 'pretend.md' }), undefined);
});
